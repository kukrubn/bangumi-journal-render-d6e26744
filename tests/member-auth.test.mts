import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  hashPassword, inviteHash, issueSession, readSession, registrationEmail, verifyAccountPassword,
} from "../src/lib/server/account-credentials.ts";
import { displayLoginName, generatedLoginName, normalizeLoginName } from "../src/lib/domain/member-login.ts";
import { AppError } from "../src/lib/domain/library.ts";

const key = randomBytes(40).toString("hex");
const admin = { uid: randomUUID(), email: "admin@example.org", hash: "admin-hash-for-session-test" };
const member = { uid: randomUUID(), email: "friend@example.org", hash: "member-hash-for-session-test" };
const noLookup = async (): Promise<null> => { throw Error("An unverified cookie reached the database"); };

test("existing signed owner cookies remain valid, with the original expiry and rotation behavior", async () => {
  const legacy = (expiry: number) => {
    const data = expiry + "." + randomBytes(18).toString("hex");
    const mac = createHmac("sha256", key).update(["journal-cookie-v1", admin.uid, admin.email, admin.hash, data].join("|")).digest("base64url");
    return data + "." + mac;
  };
  const now = Math.floor(Date.now() / 1000);
  const cookie = legacy(now + 900);
  assert.equal(await readSession(key, admin, cookie, noLookup), admin);
  assert.equal(await readSession(key, admin, issueSession(key, admin.uid, admin), noLookup), admin);
  assert.equal(await readSession(key, admin, legacy(now - 1), noLookup), null);
  assert.equal(await readSession(key, { ...admin, hash: "changed" }, cookie, noLookup), null);
});

test("member sessions resolve only their signed UID and current credentials", async () => {
  const cookie = issueSession(key, admin.uid, member);
  assert.equal(cookie.includes(member.email), false);
  assert.equal(cookie.includes(member.hash), false);
  assert.deepEqual(await readSession(key, admin, cookie, async (uid) => {
    assert.equal(uid, member.uid);
    return member;
  }), member);
  assert.equal(await readSession(key, admin, cookie.replace(member.uid, randomUUID()), noLookup), null);
  assert.equal(await readSession(key, admin, cookie.replace(member.uid, admin.uid), noLookup), null);
  assert.equal(await readSession("another signing key", admin, cookie, noLookup), null);
  assert.equal(await readSession(key, admin, cookie, async () => null), null);
  assert.equal(await readSession(key, admin, cookie, async () => admin), null);
  assert.equal(await readSession(key, admin, cookie, async () => ({ ...member, hash: "changed" })), null);
  assert.equal(await readSession(key, admin, cookie, async () => ({ ...member, email: "changed@example.org" })), null);
});

test("password-only registration and optional email have distinct canonical identities", () => {
  const token = randomBytes(32).toString("base64url");
  assert.equal(token.length, 43);
  const digest = inviteHash(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.throws(() => inviteHash("invalid"), AppError);
  const code = "bj-" + digest.slice(0, 16);
  assert.equal(generatedLoginName(digest), code);
  assert.equal(registrationEmail(undefined, digest, admin.email), code + "@members.invalid");
  assert.equal(registrationEmail("  ", digest, admin.email), code + "@members.invalid");
  assert.equal(registrationEmail("  Friend@Example.org ", digest, admin.email), member.email);
  assert.equal(normalizeLoginName(" " + code.toUpperCase() + " "), code + "@members.invalid");
  assert.equal(displayLoginName(normalizeLoginName(code)), code);
  assert.equal(displayLoginName("me@example.org"), "me@example.org");
  assert.equal(displayLoginName("other@members.invalid"), "other@members.invalid");
  for (const value of [code + "@members.invalid", "x@MEMBERS.INVALID", "Admin@Example.Org", {}, "missing-at"])
    assert.throws(() => registrationEmail(value, digest, admin.email), AppError);
});

test("salted member passwords check correctly and the attempt limit isolates different accounts", async () => {
  const pwd = randomBytes(18).toString("hex");
  const first = await hashPassword(pwd), second = await hashPassword(pwd);
  assert.match(first, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyAccountPassword(member.uid, first, pwd), true);
  assert.equal(await verifyAccountPassword(member.uid, first, pwd + "bad"), false);
  assert.equal(await verifyAccountPassword(null, first, pwd), false);
  const noisy = randomUUID();
  for (let n = 0; n < 10; n++) assert.equal(await verifyAccountPassword(noisy, first, "x".repeat(1025)), false);
  await assert.rejects(verifyAccountPassword(noisy, first, pwd), (err: unknown) => err instanceof AppError && err.status === 429);
  assert.equal(await verifyAccountPassword(member.uid, first, pwd), true);
  await assert.rejects(hashPassword("short"), AppError);
  await assert.rejects(hashPassword("界".repeat(342)), AppError);
});
