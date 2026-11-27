import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { planRestore } from "../src/lib/domain/backup.ts";

async function asOwner(client, uid) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
    [uid, JSON.stringify({ sub: uid, role: "authenticated" })],
  );
  const result = await client.query("SELECT public.is_app_owner() AS bound");
  if (!result.rows[0]?.bound) throw new Error("The database owner binding does not match.");
}

async function snapshot(client) {
  return (await client.query("SELECT public.backup_snapshot() AS data")).rows[0].data;
}

// Merge a consistent source snapshot; checking the result before COMMIT also covers ID remapping.
export async function copyDeveloperShelf({ source, destination, ownerId }) {
  const local = new pg.Client(source);
  const remote = new pg.Client(destination);
  try {
    await local.connect();
    await local.query("BEGIN READ ONLY");
    await asOwner(local, ownerId);
    const exported = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: (await snapshot(local)).tables,
    };
    await local.query("COMMIT");
    await remote.connect();
    await remote.query("BEGIN");
    await asOwner(remote, ownerId);
    const current = await snapshot(remote);
    const { changes, preview } = planRestore(exported, current.tables);
    if (preview.invalid.length || preview.conflicts.length) {
      throw new Error("Source validation or a cloud conflict requires review in JSON recovery.");
    }
    if (preview.added) {
      await remote.query("SELECT public.restore_backup($1::jsonb,$2::text)", [
        JSON.stringify(changes),
        current.revision,
      ]);
    }
    const verified = planRestore(exported, (await snapshot(remote)).tables).preview;
    if (verified.invalid.length || verified.added || verified.conflicts.length) {
      throw new Error("Cloud data did not match the source snapshot.");
    }
    await remote.query("COMMIT");
    return {
      added: preview.added,
      matched: verified.unchanged,
      counts: Object.fromEntries(Object.entries(exported.tables).map(([table, rows]) => [table, rows.length])),
    };
  } finally {
    // Disconnect also rolls back an open transaction on any exception.
    await Promise.allSettled([local.end(), remote.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.JOURNAL_DATABASE_URL) throw new Error("Missing cloud connection.");
    const destination = new URL(process.env.JOURNAL_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)) {
      destination.searchParams.set("sslmode", "verify-full");
    }
    const localFile = new URL("../.journal-local/database.json", import.meta.url);
    const local = JSON.parse(await fs.readFile(localFile, "utf8"));
    console.log(await copyDeveloperShelf({
      source: {
        host: "127.0.0.1",
        port: local.pg,
        user: "journal_admin",
        password: local.adminPassword,
        database: "postgres",
        connectionTimeoutMillis: 15000,
      },
      destination: { connectionString: destination.href, connectionTimeoutMillis: 15000 },
      ownerId: local.owner,
    }));
  } catch (err) {
    // Database driver errors may contain connection details or personal record values.
    console.error("Shelf transfer failed. Check both owner bindings, connection settings and JSON conflicts.",
      /^[A-Z0-9_]+$/.test(err?.code ?? "") ? err.code : "");
    process.exitCode = 1;
  }
}
