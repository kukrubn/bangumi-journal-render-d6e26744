import "server-only";
import { Pool, type PoolConfig } from "pg";
import { postgresTransport } from "./postgres-transport.ts";

export function connectionOptions(value: string): PoolConfig {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const plaintext = url.searchParams.get("sslmode") === "disable";
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || (plaintext && !local))
    throw new Error("Invalid PostgreSQL configuration");
  // Pass connection fields separately so a URI sslmode cannot override certificate verification in pg.
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: plaintext ? false : { rejectUnauthorized: true },
    enableChannelBinding: true,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
    max: 3,
    allowExitOnIdle: true,
    application_name: "bangumi-journal",
  };
}

let pool: Pool | undefined;
export function developerPostgres(url: string, owner: string) {
  if (!pool) {
    pool = new Pool(connectionOptions(url));
    pool.on("error", () => console.error("Idle journal database connection closed"));
  }
  const database = pool;
  return postgresTransport(owner, async ({ text, values }) => {
    const client = await database.connect();
    let discard = false;
    try {
      await client.query("BEGIN; SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [owner, JSON.stringify({ sub: owner, role: "authenticated" })]);
      const result = await client.query<{ data: unknown }>(text, values);
      await client.query("COMMIT");
      return result.rows.map(row => row.data);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
