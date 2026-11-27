import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { prepareCloudDatabase } from "./cloud-db.mjs";
import { copyDeveloperShelf } from "./copy-developer-shelf.mjs";

// Run on the Windows computer that owns the existing developer shelf.
// Keep the same restricted credentials across retries and deploys.
const root = new URL("../", import.meta.url);
const secretFile = new URL(".journal-local/render-production.env", root);
if (!URL.canParse(process.env.JOURNAL_DB_ADMIN_URL ?? "")) {
  throw new Error("Set JOURNAL_DB_ADMIN_URL to the direct Neon administrator connection.");
}
const admin = new URL(process.env.JOURNAL_DB_ADMIN_URL);
if (admin.protocol !== "postgresql:" && admin.protocol !== "postgres:") throw new Error("Expected a PostgreSQL URI.");
if (!admin.hostname.endsWith(".neon.tech") || admin.hostname.split(".")[0].endsWith("-pooler")) {
  throw new Error("Supply the direct Neon administrator connection.");
}
admin.searchParams.set("sslmode", "verify-full");
const local = parseEnv(await readFile(new URL(".env.local", root), "utf8"));
const db = JSON.parse(await readFile(new URL(".journal-local/database.json", root), "utf8"));
if (local.JOURNAL_DEV_OWNER !== db.owner) throw new Error("The local database and login have different owners.");
const accountKeys = ["JOURNAL_DEV_EMAIL", "JOURNAL_DEV_OWNER", "JOURNAL_DEV_PASSWORD_HASH", "BANGUMI_USER_AGENT"];
for (const key of accountKeys) {
  if (!local[key] || /[\r\n\x00"]/.test(local[key])) throw new Error("Invalid configuration for " + key);
}

try {
  const candidate = new URL(admin);
  candidate.hostname = candidate.hostname.replace(".", "-pooler.");
  candidate.username = "journal_app_" + randomBytes(6).toString("hex");
  candidate.password = randomBytes(32).toString("hex");
  const config = {
    ...Object.fromEntries(accountKeys.map((key) => [key, local[key]])),
    JOURNAL_DATABASE_URL: candidate.href,
    JOURNAL_DEV_JWT_SECRET: randomBytes(40).toString("hex"),
  };
  const file = Object.entries(config).map(([key, value]) => key + '="' + value + '"').join("\n") + "\n";
  await writeFile(secretFile, file, { flag: "wx", mode: 0o600 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}

const config = parseEnv(await readFile(secretFile, "utf8"));
if (!accountKeys.every((key) => config[key] === local[key])) {
  throw new Error("Existing Render settings differ from the local account. Review the secret file before redeploying.");
}
try {
  const { applied } = await prepareCloudDatabase({
    adminUrl: admin.href, runtimeUrl: config.JOURNAL_DATABASE_URL,
    ownerId: db.owner, initialize: true,
  });
  const copied = await copyDeveloperShelf({
    source: {
      host: "127.0.0.1", port: db.pg, database: "postgres",
      user: "journal_admin", password: db.adminPassword, connectionTimeoutMillis: 15000,
    },
    destination: { connectionString: config.JOURNAL_DATABASE_URL, connectionTimeoutMillis: 15000 },
    ownerId: db.owner,
  });
  console.log({ migrationsApplied: applied.length, ...copied });
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "setup or data conflict";
  console.error("Cloud migration incomplete (" + code + ").");
  process.exitCode = 1;
}
