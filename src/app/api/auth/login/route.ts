import { jsonApi, body } from "@/lib/server/api";
import { cookies } from "next/headers";
import {
  developerConfig,
  developerDb,
  devCookie,
  openSession,
  sessionLifetime,
  verifyPassword,
} from "@/lib/server/developer-auth";
import { isProjectAuthCookie, projectConfig } from "@/lib/supabase/config";
import { AppError } from "@/lib/domain/library";
import { cloudDb, databaseError } from "@/lib/supabase/server";
export function POST(req: Request) {
  return jsonApi(req, async (headers) => {
    const { email, password, mode } = await body(req);
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password)
      throw new AppError(422, "请填写邮箱和密码");
    const dev = developerConfig();
    const jar = await cookies();
    const cloud = projectConfig();
    if (mode === "developer" && (!dev || email.trim().toLowerCase() !== dev.email))
      throw new AppError(401, "邮箱或密码有误");
    if (mode !== "cloud" && dev && email.trim().toLowerCase() === dev.email) {
      if (!(await verifyPassword(dev, password))) throw new AppError(401, "邮箱或密码有误");
      const { data, error } = await developerDb(dev).rpc("is_app_owner");
      if (error) databaseError(error);
      if (!data) throw new AppError(403, "开发者账号未绑定到片单");
      // Discard previous cloud session locally so logout cannot expose another shelf.
      if (cloud)
        for (const c of jar.getAll())
          if (isProjectAuthCookie(cloud.url, c.name)) jar.delete(c.name);
      jar.set(devCookie, openSession(dev), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionLifetime,
        secure: new URL(req.url).protocol === "https:" || !!process.env.VERCEL || process.env.RENDER === "true",
      });
      return { ok: true };
    }
    if (!projectConfig() && dev) throw new AppError(401, "邮箱或密码有误");
    const db = await cloudDb(headers);
    const login = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (login.error) {
      if (login.error.status === 429) throw new AppError(429, "尝试次数过多，请稍后再登录");
      if (!login.error.status || login.error.status >= 500)
        throw new AppError(503, "无法连接登录服务，请检查配置与网络");
      throw new AppError(401, "邮箱、密码或邮箱确认状态有误");
    }
    const owner = await db.rpc("is_app_owner");
    if (owner.error || !owner.data) {
      await db.auth.signOut({ scope: "local" });
      if (owner.error) databaseError(owner.error);
      throw new AppError(403, "此账号未绑定到这份片单");
    }
    jar.delete(devCookie);
    return { ok: true };
  });
}
