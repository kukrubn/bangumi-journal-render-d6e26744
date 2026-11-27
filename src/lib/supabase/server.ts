import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { AppError } from "@/lib/domain/library";
import { projectConfig } from "./config";
import { developerConfig, developerDb, devCookie, validSession } from "@/lib/server/developer-auth";

export type Db = SupabaseClient<Database>;
export type Owner = { db: Db; uid: string; email: string };
const developerOwners = new WeakMap<Db, { uid: string; email: string }>();
export async function serverDb(writeHeaders?: Headers): Promise<Db> {
  const jar = await cookies();
  const developer = developerConfig();
  if (developer && validSession(developer, jar.get(devCookie)?.value ?? "")) {
    const db = developerDb(developer);
    developerOwners.set(db, { uid: developer.uid, email: developer.email });
    return db;
  }
  if (developer && !projectConfig()) throw new AppError(401, "请登录后使用片单");
  if (process.env.JOURNAL_DATABASE_URL) throw new AppError(503, "请检查开发者账号和云数据库配置");
  return cloudDb(writeHeaders);
}
export async function cloudDb(writeHeaders?: Headers): Promise<Db> {
  const cfg = projectConfig();
  if (!cfg)
    throw new AppError(
      503,
      process.env.JOURNAL_DATABASE_URL
        ? "请使用已配置的开发者账号登录"
        : "请先在 .env.local 中填写 Supabase 项目地址与 publishable key，再重启应用",
    );
  const jar = await cookies();
  return createServerClient<Database>(cfg.url, cfg.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(set, headers) {
        if (!writeHeaders) return; // Server Components receive cookies refreshed by proxy.ts.
        for (const { name, value, options } of set) jar.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) writeHeaders.set(key, value);
      },
    },
  });
}
export function databaseError(e: { code?: string; message?: string }): never {
  if (e.code === "42501") throw new AppError(403, "当前账号没有访问此片单的权限");
  if (e.code === "P0002") throw new AppError(404, "这部番已被移除");
  if (e.code === "23503") throw new AppError(409, "关联记录已更改，请刷新后重试");
  if (e.code === "23505") throw new AppError(409, "条目已经存在，请刷新片单");
  if (e.code === "23514" || e.code?.startsWith("22"))
    throw new AppError(422, "提交的数据不符合数据库约束，请检查字段");
  if (e.code === "PGRST202" || e.code === "42883")
    throw new AppError(503, "数据库函数尚未就绪，请检查项目迁移");
  if (e.code === "PGRST301" || e.code === "PGRST303")
    throw new AppError(401, "登录已过期，请重新登录");
  throw new AppError(503, "暂时无法访问片单数据库，请检查网络与数据库配置后重试");
}
export async function requireOwner(db: Db): Promise<Owner> {
  const developer = developerOwners.get(db);
  if (developer) {
    const owner = await db.rpc("is_app_owner");
    if (owner.error) databaseError(owner.error);
    if (!owner.data) throw new AppError(403, "开发者账号未绑定到这份片单");
    return { db, ...developer };
  }
  const { data, error } = await db.auth.getClaims();
  if (error && (error.status ?? 0) >= 500) throw new AppError(503, "登录服务暂时不可用");
  if (!data?.claims?.sub) throw new AppError(401, "请登录后使用片单");
  const owner = await db.rpc("is_app_owner");
  if (owner.error) databaseError(owner.error);
  if (owner.data !== true) throw new AppError(403, "该账号尚未绑定为片单所有者");
  return { db, uid: data.claims.sub, email: String(data.claims.email ?? "") };
}
