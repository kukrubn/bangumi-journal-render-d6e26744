import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

class SetupError extends Error {}
function check(condition, message) {
  if (!condition) throw new SetupError(message);
}

function target(connectionString) {
  check(connectionString && URL.canParse(connectionString), "Provide a valid PostgreSQL URI.");
  const url = new URL(connectionString);
  check(["postgresql:", "postgres:"].includes(url.protocol), "Expected a PostgreSQL URI.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  check(
    local || ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")),
    "Remote PostgreSQL URIs must enable TLS.",
  );
  const database = decodeURIComponent(url.pathname.slice(1));
  check(database && !["template0", "template1"].includes(database), "Select a dedicated database.");
  return {
    host: url.hostname.replace(/-pooler(?=\..*\.neon\.tech$)/, ""),
    port: url.port || "5432",
    database,
    role: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

async function role(client, name) {
  const { rows } = await client.query(
    `
    select oid::text, rolcanlogin, rolsuper or rolbypassrls or rolcreatedb or rolcreaterole
      or rolreplication as elevated, rolinherit,
      array(select roleid::regrole::text from pg_catalog.pg_auth_members where member=r.oid) as memberships
    from pg_catalog.pg_roles r where rolname=$1`,
    [name],
  );
  return rows[0];
}

function checkGroup(group) {
  check(
    group && !group.rolcanlogin && !group.elevated && group.memberships.length === 0,
    "An application group has incompatible privileges. Use a dedicated PostgreSQL instance.",
  );
}

async function createRuntimeRole(client, runtime) {
  // Neon requires the actual password for its control plane. COPY sends it as protocol data,
  // outside client SQL text, logged SQL parameters and the process command line.
  await client.query(`set local password_encryption = 'scram-sha-256';
    create temporary table journal_bootstrap_login (login text, secret text) on commit drop`);
  const record = Buffer.from(
    runtime.role + "\t" + runtime.password.replaceAll("\\", "\\\\") + "\n",
  );
  try {
    await new Promise((resolve, reject) => {
      const copy = new pg.Query("copy pg_temp.journal_bootstrap_login from stdin", (err) =>
        err ? reject(err) : resolve(),
      );
      copy.handleCopyInResponse = (connection) => {
        connection.sendCopyFromChunk(record);
        connection.endCopyFrom();
      };
      client.query(copy);
    });
  } finally {
    record.fill(0);
  }
  await client.query(`do $create_login$
    declare login_name text; login_password text;
    begin
      select login, secret into strict login_name, login_password from pg_temp.journal_bootstrap_login;
      execute format('create role %I login noinherit password %L', login_name, login_password);
    exception when others then
      raise exception using errcode=sqlstate, message='Database could not create the application login.';
    end;
    $create_login$`);
}

async function initializeDatabase(client, runtime, ownerId) {
  // Reject occupied application schemas. Built-in objects and extension members are allowed.
  const {
    rows: [inventory],
  } = await client.query(`
    select exists (
      select 1 from pg_catalog.pg_namespace n where n.nspname not in ('public','information_schema')
      and n.nspname !~ '^pg_' and not (
        n.nspname in ('neon','neon_migration') and n.nspowner = coalesce(to_regrole('cloud_admin')::oid,0)
      ) and not exists (
        select 1 from pg_catalog.pg_extension x where x.extnamespace=n.oid)
    ) or exists (
      select 1 from (
        select 'pg_class'::regclass as catalog,oid from pg_catalog.pg_class where relnamespace='public'::regnamespace
        union all select 'pg_proc'::regclass,oid from pg_catalog.pg_proc where pronamespace='public'::regnamespace
        union all select 'pg_type'::regclass,oid from pg_catalog.pg_type where typnamespace='public'::regnamespace
          and typelem=0 and typrelid=0
      ) o where not exists(select 1 from pg_catalog.pg_depend d where d.classid=o.catalog and d.objid=o.oid and d.deptype='e')
    ) as occupied`);
  check(
    !inventory.occupied,
    "The database already contains application objects. Select an empty dedicated database.",
  );
  check(
    !(await role(client, runtime.role)),
    "The requested runtime role already exists. Choose a fresh role name.",
  );
  for (const name of ["anon", "authenticated"]) {
    const existing = await role(client, name);
    if (existing) {
      checkGroup(existing);
    } else {
      await client.query(`create role ${name} nologin`);
    }
  }
  await createRuntimeRole(client, runtime);
  try {
    await client.query(`grant authenticated to "${runtime.role}"`);
  } catch (error) {
    if (error.code === "42501")
      throw new SetupError(
        "The administrator needs the right to grant the existing authenticated group in this instance.",
      );
    throw error;
  }
  await client.query(
    `grant connect on database ${pg.escapeIdentifier(runtime.database)} to "${runtime.role}"`,
  );
  await client.query(`revoke create on schema public from public;
    create schema journal_cloud;
    revoke all on schema journal_cloud from public, anon, authenticated;
    create table journal_cloud.installation (
      singleton boolean primary key check(singleton), owner_uid uuid not null, runtime_role oid not null
    );
    create table journal_cloud.migrations (name text primary key, sha256 text not null);
    create schema auth;
    revoke all on schema auth from public;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    revoke all on function auth.uid() from public;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await client.query("insert into auth.users(id) values($1)", [ownerId]);
  await client.query("insert into journal_cloud.installation values(true,$1,$2::regrole::oid)", [
    ownerId,
    runtime.role,
  ]);
}

async function applyMigrations(client) {
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(folder)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const { rows } = await client.query(
    "select name,sha256 from journal_cloud.migrations order by name",
  );
  check(
    rows.every((row, i) => row.name === files[i]),
    "Installed migration history diverges from this release.",
  );
  for (const [i, name] of files.entries()) {
    const script = (await readFile(new URL(name, folder), "utf8")).replaceAll("\r\n", "\n");
    const digest = createHash("sha256").update(script).digest("hex");
    if (rows[i]) {
      check(rows[i].sha256 === digest, "Installed migration content differs: " + name);
      continue;
    }
    // The repository migrations wrap themselves with BEGIN/COMMIT. The surrounding transaction
    // commits their SQL, version ledger and owner binding atomically.
    const wrapped = /^(?:\s*--[^\n]*\n)*\s*begin;([\s\S]*?)\n\s*commit;\s*$/i.exec(script);
    check(wrapped, "Expected a transaction-wrapped migration: " + name);
    await client.query(wrapped[1]);
    await client.query("insert into journal_cloud.migrations values($1,$2)", [name, digest]);
  }
  return files.slice(rows.length);
}

export async function prepareCloudDatabase({ adminUrl, runtimeUrl, ownerId, initialize = false }) {
  const admin = target(adminUrl),
    runtime = target(runtimeUrl);
  check(
    admin.host === runtime.host &&
      admin.port === runtime.port &&
      admin.database === runtime.database,
    "Administrator and runtime connections must target the same database.",
  );
  check(
    /^[a-z][a-z0-9_]{0,62}$/.test(runtime.role) &&
      !runtime.role.startsWith("pg_") &&
      !["anon", "authenticated", "public"].includes(runtime.role) &&
      admin.role !== runtime.role,
    "Provide a distinct lowercase runtime role.",
  );
  check(
    /^[\x21-\x7e]{32,}$/.test(runtime.password),
    "Use a random printable ASCII runtime secret of at least 32 characters.",
  );
  check(
    typeof ownerId === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(ownerId),
    "Provide a valid owner UUID.",
  );
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 15000 });
  let applied;
  await client.connect();
  try {
    await client.query("begin");
    const connection = await client.query(
      "select current_database()=$1 and session_user=$2 as matches",
      [admin.database, admin.role],
    );
    check(
      connection.rows[0].matches,
      "Actual administrator connection differs from the selected database and role.",
    );
    await client.query("select pg_advisory_xact_lock(hashtext('bangumi-journal/cloud-schema-v1'))");
    const {
      rows: [state],
    } = await client.query(
      "select to_regclass('journal_cloud.installation') is not null as installed",
    );
    if (!state.installed) {
      check(initialize, "First-time setup requires --initialize on a dedicated empty database.");
      await initializeDatabase(client, runtime, ownerId);
    } else {
      checkGroup(await role(client, "anon"));
      checkGroup(await role(client, "authenticated"));
    }
    const {
      rows: [installation],
    } = await client.query(
      "select owner_uid=$1::uuid and runtime_role=to_regrole($2)::oid as matches from journal_cloud.installation where singleton",
      [ownerId, runtime.role],
    );
    check(installation?.matches, "Owner or runtime role does not match this installation.");
    const login = await role(client, runtime.role);
    check(
      login?.rolcanlogin &&
        !login.elevated &&
        !login.rolinherit &&
        login.memberships.length === 1 &&
        login.memberships[0] === "authenticated",
      "Runtime role privileges differ from this installation.",
    );
    applied = await applyMigrations(client);
    if (!state.installed)
      await client.query("insert into app_private.app_owner(user_id) values($1)", [ownerId]);
    const {
      rows: [binding],
    } = await client.query(
      "select user_id=$1::uuid as matches from app_private.app_owner where singleton",
      [ownerId],
    );
    check(binding?.matches, "Existing data has a different owner binding.");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  // Verify the real deployment credentials and row-level ownership on a fresh connection.
  const app = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 15000 });
  await app.connect();
  try {
    await app.query("begin");
    const connection = await app.query(
      "select current_database()=$1 and session_user=$2 as matches",
      [runtime.database, runtime.role],
    );
    check(
      connection.rows[0].matches,
      "Actual application connection differs from the selected database and role.",
    );
    await app.query("set local role authenticated");
    await app.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId]);
    const {
      rows: [owner],
    } = await app.query("select public.is_app_owner() as bound");
    check(owner.bound, "Runtime ownership verification failed.");
    await app.query("rollback");
  } finally {
    await app.end();
  }
  return { applied, database: admin.database, runtimeRole: runtime.role };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await prepareCloudDatabase({
      adminUrl: process.env.JOURNAL_DB_ADMIN_URL,
      runtimeUrl: process.env.JOURNAL_DATABASE_URL,
      ownerId: process.env.JOURNAL_DEV_OWNER,
      initialize: process.argv.includes("--initialize"),
    });
    console.log(`Database and owner verified. Applied ${result.applied.length} migrations.`);
  } catch (error) {
    // Driver errors may contain connection or query details. Only expose safe application messages and SQLSTATE.
    console.error(
      error instanceof SetupError
        ? error.message
        : "Cloud migration failed (" +
            (/^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "connection or SQL error") +
            ").",
    );
    process.exitCode = 1;
  }
}
