import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "../domain/library.ts";
import { generatedLoginName } from "../domain/member-login.ts";

export type LoginAccount = { uid: string; email: string; hash: string };
export const sessionLifetime = 7 * 86400;
const scryptAsync = promisify(scrypt);
const passwordHashPattern = /^[0-9a-f]{32}:[0-9a-f]{128}$/;
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const sign = (secret: string, data: string) =>
  createHmac("sha256", secret).update(data).digest("base64url");

let hashing = 0;
async function derive(password: string, salt: string) {
  if (hashing >= 3) throw new AppError(429, "登录服务正忙，请稍后重试", 2);
  hashing++;
  try {
    return ((await scryptAsync(password, Buffer.from(salt, "hex"), 64)) as Buffer).toString("hex");
  } finally {
    hashing--;
  }
}

export async function hashPassword(password: string) {
  if (password.length < 8 || Buffer.byteLength(password) > 1024)
    throw new AppError(422, "密码至少需要 8 个字符，最多 1024 字节");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await derive(password, salt));
}

// Failed attempts are isolated per known account. Unknown names share one bucket.
const attempts = new Map<string, { until: number; count: number }>();
let nextCleanup = 0;
export async function verifyAccountPassword(uid: string | null, hash: string, password: string) {
  const now = Date.now(),
    key = uid ?? "unknown";
  if (now >= nextCleanup) {
    for (const [id, window] of attempts) if (window.until <= now) attempts.delete(id);
    nextCleanup = now + 60000;
  }
  let window = attempts.get(key);
  if (!window || window.until <= now) {
    window = { until: now + 60000, count: 0 };
    attempts.set(key, window);
  }
  if (window.count >= 10)
    throw new AppError(429, "尝试次数过多，请稍后重新登录", Math.ceil((window.until - now) / 1000));
  window.count++;
  if (Buffer.byteLength(password) > 1024 || !passwordHashPattern.test(hash)) return false;
  const [salt, expected] = hash.split(":");
  const ok = equal(await derive(password, salt), expected) && uid !== null;
  if (ok) attempts.delete(key);
  return ok;
}

function adminMac(secret: string, account: LoginAccount, data: string) {
  return sign(
    secret,
    ["journal-cookie-v1", account.uid, account.email, account.hash, data].join("|"),
  );
}
function memberVersion(secret: string, account: LoginAccount) {
  return sign(
    secret,
    ["journal-member-version", account.uid, account.email, account.hash].join("|"),
  );
}
export function issueSession(secret: string, adminUid: string, account: LoginAccount) {
  const data =
    Math.floor(Date.now() / 1000) + sessionLifetime + "." + randomBytes(18).toString("hex");
  // Retain the original owner's cookie wire format and password-change invalidation.
  if (account.uid === adminUid) return data + "." + adminMac(secret, account, data);
  const payload = ["m1", account.uid, data, memberVersion(secret, account)].join(".");
  return payload + "." + sign(secret, "journal-member-cookie|" + payload);
}

export async function readSession(
  secret: string,
  admin: LoginAccount,
  token: string,
  memberByUid: (uid: string) => Promise<LoginAccount | null>,
): Promise<LoginAccount | null> {
  if (/^\d{10}\.[0-9a-f]{36}\.[\w-]{43}$/.test(token)) {
    const [expiry, nonce, mac] = token.split(".");
    return Number(expiry) > Date.now() / 1000 &&
      equal(mac, adminMac(secret, admin, expiry + "." + nonce))
      ? admin
      : null;
  }
  if (
    !/^m1\.[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.\d{10}\.[0-9a-f]{36}\.[\w-]{43}\.[\w-]{43}$/.test(
      token,
    )
  )
    return null;
  const [, uid, expiry, , version, mac] = token.split(".");
  if (uid === admin.uid || Number(expiry) <= Date.now() / 1000) return null;
  const payload = token.slice(0, token.lastIndexOf("."));
  if (!equal(mac, sign(secret, "journal-member-cookie|" + payload))) return null;
  const account = await memberByUid(uid);
  return account?.uid === uid && equal(version, memberVersion(secret, account)) ? account : null;
}

export function inviteHash(token: unknown) {
  if (typeof token !== "string" || !/^[\w-]{43}$/.test(token))
    throw new AppError(400, "邀请链接无效");
  return createHash("sha256").update(token).digest("hex");
}

export function registrationEmail(input: unknown, tokenHash: string, reserved: string) {
  if (input != null && typeof input !== "string") throw new AppError(422, "请输入有效邮箱");
  const email = input?.trim().toLowerCase() ?? "";
  if (!email) {
    const generated = generatedLoginName(tokenHash) + "@members.invalid";
    if (generated === reserved) throw new AppError(409, "这个登录名已被使用，请填写其他邮箱");
    return generated;
  }
  if (
    Buffer.byteLength(email) > 254 ||
    !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)
  )
    throw new AppError(422, "请输入有效邮箱");
  if (email === reserved || email.endsWith("@members.invalid"))
    throw new AppError(409, "这个登录名无法注册，请填写其他邮箱");
  return email;
}
