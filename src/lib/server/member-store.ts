import "server-only";
import { randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import { AppError } from "../domain/library.ts";
import { inviteHash, type LoginAccount } from "./account-credentials.ts";
import { journalPool } from "./postgres";

type Invite = {
  id: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
};

// Only these fixed statements use the restricted runtime login's private RPC grants.
// All normal shelf operations still run inside the authenticated RLS transaction.
async function query<T extends QueryResultRow>(database: string, sql: string, values: string[]) {
  try {
    return (await journalPool(database).query<T>(sql, values)).rows;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "P0002") throw new AppError(410, "邀请无效、已过期或已被使用");
    if (code === "23505") throw new AppError(409, "这个登录名已被使用，请填写其他邮箱");
    if (code === "42501") throw new AppError(403, "没有执行此操作的权限");
    if (code === "23514" || code === "22023") throw new AppError(422, "账号或邀请信息格式无效");
    throw new AppError(503, "账号服务暂时不可用，请稍后重试");
  }
}
export async function accountByEmail(database: string, email: string) {
  const rows = await query<LoginAccount>(
    database,
    "SELECT uid, email, password_hash AS hash FROM app_private.account_by_email($1)",
    [email],
  );
  return rows[0] ?? null;
}
export async function accountByUid(database: string, uid: string) {
  const rows = await query<LoginAccount>(
    database,
    "SELECT uid, email, password_hash AS hash FROM app_private.account_by_uid($1)",
    [uid],
  );
  return rows[0] ?? null;
}
export function listInvites(database: string, admin: string) {
  return query<Invite>(
    database,
    "SELECT id, created_at, expires_at, used_at, revoked_at FROM app_private.list_invites($1)",
    [admin],
  );
}
export async function createInvite(database: string, admin: string) {
  const token = randomBytes(32).toString("base64url");
  const [row] = await query<Invite>(
    database,
    "SELECT id, expires_at FROM app_private.create_invite($1, $2, now() + interval '7 days')",
    [admin, inviteHash(token)],
  );
  return { id: row.id, token, expires_at: row.expires_at };
}
export async function revokeInvite(database: string, admin: string, id: string) {
  const [row] = await query<{ revoked: boolean }>(
    database,
    "SELECT app_private.revoke_invite($1, $2) AS revoked",
    [admin, id],
  );
  if (!row.revoked) throw new AppError(409, "此邀请已经失效，请刷新列表");
}
export async function checkInvite(database: string, hash: string) {
  const [row] = await query<{ available: boolean }>(
    database,
    "SELECT app_private.invite_available($1) AS available",
    [hash],
  );
  if (!row.available) throw new AppError(410, "邀请无效、已过期或已被使用");
}
export async function redeemInvite(
  database: string,
  hash: string,
  email: string,
  passwordHash: string,
): Promise<LoginAccount> {
  const [row] = await query<{ uid: string }>(
    database,
    "SELECT app_private.redeem_invite($1, $2, $3) AS uid",
    [hash, email, passwordHash],
  );
  return { uid: row.uid, email, hash: passwordHash };
}
