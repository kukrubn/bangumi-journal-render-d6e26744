import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, ".journal-local");
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw Error("Usage: node scripts/setup-developer.mjs your@email.example");
if (!process.stdin.isTTY) throw Error("Run in a terminal to enter your password privately.");
async function password() {
  process.stdout.write("Password (hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  try {
    return await new Promise((resolve, reject) => {
      let value = "";
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n" || ch === "\x03") {
            process.stdin.off("data", onData);
            if (ch === "\x03") reject(Error("Cancelled"));
            else resolve(value);
            return;
          }
          if (ch === "\x7f" || ch === "\b") value = value.slice(0, -1);
          else if (ch >= " ") value += ch;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  }
}
const pass = await password();
if (pass.length < 8 || Buffer.byteLength(pass) > 1024)
  throw Error("Password must be 8 or more characters and at most 1024 bytes.");
await mkdir(dir, { recursive: true, mode: 0o700 });
async function port() {
  const s = net.createServer();
  await new Promise((ok, fail) => s.once("error", fail).listen(0, "127.0.0.1", ok));
  const n = s.address().port;
  await new Promise((ok) => s.close(ok));
  return n;
}
const configPath = path.join(dir, "database.json");
let cfg;
try {
  cfg = JSON.parse(await readFile(configPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  cfg = {
    owner: randomUUID(),
    pg: await port(),
    rest: await port(),
    adminPassword: randomBytes(24).toString("hex"),
    restPassword: randomBytes(24).toString("hex"),
    jwt: randomBytes(36).toString("hex"),
  };
  while (cfg.pg === cfg.rest) cfg.rest = await port();
  await writeFile(configPath, JSON.stringify(cfg), { flag: "wx", mode: 0o600 });
}
const salt = randomBytes(16);
const file = path.join(root, ".env.local");
let env = await readFile(file, "utf8").catch((e) => {
  if (e.code === "ENOENT") return "";
  throw e;
});
function set(key, value) {
  const re = new RegExp("^" + key + "=.*$", "m");
  env = re.test(env)
    ? env.replace(re, key + "=" + value)
    : env.trimEnd() + "\n" + key + "=" + value + "\n";
}
set("JOURNAL_DEV_EMAIL", email);
set("JOURNAL_DEV_OWNER", cfg.owner);
set(
  "JOURNAL_DEV_PASSWORD_HASH",
  salt.toString("hex") + ":" + scryptSync(pass, salt, 64).toString("hex"),
);
set("JOURNAL_DEV_JWT_SECRET", cfg.jwt);
set("JOURNAL_DEV_REST_URL", "http://127.0.0.1:" + cfg.rest);
if (
  !/^BANGUMI_USER_AGENT=\s*\S+/m.test(
    env
      .replace(/\r/g, "")
      .split("\n")
      .find((x) => x.startsWith("BANGUMI_USER_AGENT=")) ?? "",
  )
)
  set("BANGUMI_USER_AGENT", "PersonalJournal/bangumi-journal/0.4.0 (personal collection tracker)");
const tmp = path.join(dir, "env-" + randomUUID());
await writeFile(tmp, env, { mode: 0o600 });
await rename(tmp, file);
console.log("Local account configured. Start with npm run dev.");
process.stdin.destroy();
