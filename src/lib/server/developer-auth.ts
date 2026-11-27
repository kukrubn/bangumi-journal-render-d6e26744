import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { AppError } from "@/lib/domain/library";
import { connectionOptions, developerPostgres } from "./postgres";

export const devCookie = "journal_developer";
export const sessionLifetime = 7 * 86400;
export function developerConfig() {
  const email = process.env.JOURNAL_DEV_EMAIL?.trim().toLowerCase();
  const hash = process.env.JOURNAL_DEV_PASSWORD_HASH;
  const uid = process.env.JOURNAL_DEV_OWNER;
  const secret = process.env.JOURNAL_DEV_JWT_SECRET;
  const database = process.env.JOURNAL_DATABASE_URL?.trim();
  const rest = process.env.JOURNAL_DEV_REST_URL?.replace(/\/+$/, "");
  if (
    !email ||
    !hash ||
    !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(hash) ||
    !uid ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uid) ||
    !secret ||
    secret.length < 32
  )
    return null;
  if (database) {
    try { connectionOptions(database); } catch { return null; }
    return { email, hash, uid, secret, database, rest: undefined };
  }
  if (!rest || !URL.canParse(rest)) return null;
  const url = new URL(rest);
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    ) ||
    url.username ||
    url.password
  )
    return null;
  return { email, hash, uid, secret, rest, database: undefined };
}
type Config = NonNullable<ReturnType<typeof developerConfig>>;
const scryptAsync = promisify(scrypt);
const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const signature = (key: string, data: string) =>
  createHmac("sha256", key).update(data).digest("base64url");
let windowStart = 0,
  failures = 0;
export async function verifyPassword(c: Config, password: string) {
  if (Date.now() - windowStart >= 60000) {
    windowStart = Date.now();
    failures = 0;
  }
  if (failures >= 10) throw new AppError(429, "尝试次数过多，请一分钟后重新登录", 60);
  failures++;
  const [salt, hash] = c.hash.split(":");
  if (Buffer.byteLength(password) > 1024) return false;
  const candidate = (await scryptAsync(password, Buffer.from(salt, "hex"), 64)) as Buffer;
  const ok = equal(candidate, Buffer.from(hash, "hex"));
  if (ok) failures = 0;
  return ok;
}
function sessionMac(c: Config, data: string) {
  return signature(c.secret, ["journal-cookie-v1", c.uid, c.email, c.hash, data].join("|"));
}
export function openSession(c: Config) {
  const data =
    Math.floor(Date.now() / 1000) + sessionLifetime + "." + randomBytes(18).toString("hex");
  return data + "." + sessionMac(c, data);
}
export function validSession(c: Config, token: string) {
  if (!/^\d{10}\.[0-9a-f]{36}\.[\w-]{43}$/.test(token)) return false;
  const [expiry, nonce, mac] = token.split(".");
  return (
    Number(expiry) > Date.now() / 1000 &&
    equal(Buffer.from(mac), Buffer.from(sessionMac(c, expiry + "." + nonce)))
  );
}
export function developerDb(c: Config) {
  if (c.database !== undefined) {
    return createClient<Database>("https://journal.invalid", "journal", {
      accessToken: async () => "journal",
      global: { fetch: developerPostgres(c.database, c.uid) },
    });
  }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return createClient<Database>(
    new URL(c.rest).origin,
    process.env.JOURNAL_DEV_GATEWAY_KEY || "journal",
    {
      accessToken: async () => {
        const now = Math.floor(Date.now() / 1000);
        const data =
          encode({ alg: "HS256", typ: "JWT" }) +
          "." +
          encode({
            sub: c.uid,
            role: "authenticated",
            aud: "authenticated",
            iat: now,
            exp: now + 120,
          });
        return data + "." + signature(c.secret, data);
      },
      global: {
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (!url.pathname.startsWith("/rest/v1/")) throw new Error("Unexpected database service");
          return fetch(c.rest + url.pathname.slice(8) + url.search, {
            ...init,
            cache: "no-store",
            redirect: "error",
          });
        },
      },
    },
  );
}
