import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";

const binaryDirectory = process.env.JOURNAL_TEST_PG_BIN;

test("a Neon direct admin endpoint pairs only with the matching pool and database", async () => {
  const { prepareCloudDatabase } = await import(
    new URL("../scripts/cloud-db.mjs", import.meta.url).href
  );
  const pool = "ep-qa-pooler.us-east-2.aws.neon.tech";
  const example = {
    adminUrl: "postgres://fixture_owner@ep-qa.us-east-2.aws.neon.tech/db?sslmode=require",
    runtimeUrl: "postgres://fixture_app:" + "x".repeat(32) + "@" + pool + "/db?sslmode=require",
    ownerId: "intentionally-invalid",
  };
  // The invalid UUID stops the positive endpoint match before opening any connection.
  await assert.rejects(prepareCloudDatabase(example), /owner UUID/);
  for (const remote of [
    example.runtimeUrl.replace("ep-qa", "ep-different"),
    example.runtimeUrl.replace("/db?", "/other?"),
  ]) {
    await assert.rejects(prepareCloudDatabase({ ...example, runtimeUrl: remote }), /same database/);
  }
});

test(
  "cloud bootstrap with a non-superuser database owner and existing managed roles",
  {
    skip:
      !binaryDirectory &&
      "Set JOURNAL_TEST_PG_BIN to the PostgreSQL bin directory to run this isolated integration test.",
    timeout: 120_000,
  },
  async () => {
    const { prepareCloudDatabase } = await import(
      new URL("../scripts/cloud-db.mjs", import.meta.url).href
    );
    const root = await mkdtemp(join(tmpdir(), "journal-cloud-pg-"));
    const data = join(root, "cluster"),
      log = join(root, "server.log"),
      passwordFile = join(root, "qa-init-password");
    function command(name: string, args: string[]) {
      const exe = process.platform === "win32" ? name + ".exe" : name;
      const result = spawnSync(join(binaryDirectory!, exe), args, {
        // Detached PostgreSQL processes on Windows otherwise retain Node's diagnostic pipes.
        stdio: "ignore",
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(result.status, 0, name + " failed: " + (result.error?.message ?? result.stderr));
    }
    const portProbe = createServer();
    await new Promise<void>((resolve, reject) =>
      portProbe.once("error", reject).listen(0, "127.0.0.1", resolve),
    );
    const address = portProbe.address();
    assert(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((err) => (err ? reject(err) : resolve())),
    );
    const runtimePassword = randomBytes(32).toString("base64url") + "'\\%";
    const adminPassword = randomBytes(32).toString("hex");
    const ownerPassword = randomBytes(32).toString("hex");
    function uri(username: string, password: string, database: string) {
      return (
        "postgres://" +
        username +
        ":" +
        encodeURIComponent(password) +
        "@127.0.0.1:" +
        port +
        "/" +
        database
      );
    }
    let started = false;
    try {
      await writeFile(passwordFile, adminPassword, { mode: 0o600 });
      command("initdb", [
        "-D",
        data,
        "-U",
        "fixture_admin",
        "--pwfile=" + passwordFile,
        "--encoding=UTF8",
        "--locale=C",
        "-A",
        "scram-sha-256",
      ]);
      command("pg_ctl", [
        "-D",
        data,
        "-l",
        log,
        "-o",
        "-h 127.0.0.1 -p " +
          port +
          " -c log_statement=all -c log_parameter_max_length=-1 -c log_parameter_max_length_on_error=-1",
        "-w",
        "start",
      ]);
      started = true;
      const conn = new pg.Client({
        connectionString: uri("fixture_admin", adminPassword, "postgres"),
      });
      await conn.connect();
      try {
        await conn.query(
          "create role cloud_admin nologin; create role neon_superuser nologin createrole createdb bypassrls; create role authenticated nologin",
        );
        await conn.query(
          "create role neondb_owner login createrole createdb in role neon_superuser password " +
            pg.escapeLiteral(ownerPassword),
        );
        await conn.query("create database neondb owner neondb_owner");
      } finally {
        await conn.end();
      }
      const provisioner = new pg.Client({
        connectionString: uri("fixture_admin", adminPassword, "neondb"),
      });
      await provisioner.connect();
      const cfg = {
        adminUrl: uri("neondb_owner", ownerPassword, "neondb"),
        runtimeUrl: uri("journal_app", runtimePassword, "neondb"),
        ownerId: randomUUID(),
      };
      try {
        await provisioner.query(
          "create schema neon_migration authorization cloud_admin; revoke all on schema neon_migration from public",
        );
        const available = await provisioner.query(
          "select 1 from pg_available_extensions where name='pg_stat_statements'",
        );
        if (available.rowCount)
          await provisioner.query("create extension pg_stat_statements with schema public");
        const initialRole = await provisioner.query("select 'authenticated'::regrole::oid as id");
        await assert.rejects(prepareCloudDatabase(cfg), /--initialize/);
        await provisioner.query("create table public.unrelated_fixture (id int)");
        await assert.rejects(
          prepareCloudDatabase({ ...cfg, initialize: true }),
          /already contains/,
        );
        await provisioner.query("drop table public.unrelated_fixture");
        // PostgreSQL 16+ requires ADMIN on an existing group to grant its membership.
        if (
          Number((await provisioner.query("show server_version_num")).rows[0].server_version_num) >=
          160000
        ) {
          await assert.rejects(
            prepareCloudDatabase({ ...cfg, initialize: true }),
            /right to grant/,
          );
          assert.equal(
            (await provisioner.query("select to_regrole('journal_app') as role")).rows[0].role,
            null,
          );
        }
        await provisioner.query("grant authenticated to neondb_owner with admin option");
        assert((await prepareCloudDatabase({ ...cfg, initialize: true })).applied.length >= 5);
        const [one, two] = await Promise.all([
          prepareCloudDatabase(cfg),
          prepareCloudDatabase(cfg),
        ]);
        assert.deepEqual([one.applied, two.applied], [[], []]);
        const other = randomUUID();
        await assert.rejects(prepareCloudDatabase({ ...cfg, ownerId: other }), /does not match/);
        assert.deepEqual(
          (await provisioner.query("select 'authenticated'::regrole::oid as id")).rows,
          initialRole.rows,
        );
        const app = new pg.Client({ connectionString: cfg.runtimeUrl });
        await app.connect();
        try {
          await assert.rejects(app.query("select * from public.library_entries"), {
            code: "42501",
          });
          await app.query("begin; set local role authenticated");
          await app.query("select set_config('request.jwt.claim.sub',$1,true)", [cfg.ownerId]);
          await app.query("insert into public.library_entries(title_cn) values('fixture')");
          assert.equal(
            (await app.query("select count(*)::int as n from public.library_entries")).rows[0].n,
            1,
          );
          await app.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
          assert.equal(
            (await app.query("select count(*)::int as n from public.library_entries")).rows[0].n,
            0,
          );
          await app.query("rollback");
        } finally {
          await app.end();
        }
      } finally {
        await provisioner.end();
      }
      command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      started = false;
      assert(
        !(await readFile(log, "utf8")).includes(runtimePassword),
        "Runtime password appeared in PostgreSQL logs",
      );
    } finally {
      if (started) command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
