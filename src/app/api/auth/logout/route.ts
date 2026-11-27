import { jsonApi } from "@/lib/server/api";
import { cookies } from "next/headers";
import { devCookie } from "@/lib/server/developer-auth";
import { cloudDb } from "@/lib/supabase/server";
import { isProjectAuthCookie, projectConfig } from "@/lib/supabase/config";
import { AppError } from "@/lib/domain/library";
export function POST(req: Request) {
  return jsonApi(req, async (headers) => {
    const jar = await cookies();
    const wasDeveloper = jar.has(devCookie),
      cloud = projectConfig();
    jar.delete(devCookie);
    if (wasDeveloper && cloud)
      for (const c of jar.getAll()) if (isProjectAuthCookie(cloud.url, c.name)) jar.delete(c.name);
    if (wasDeveloper || !cloud) return { ok: true };
    const db = await cloudDb(headers);
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error) throw new AppError(503, "退出未完成，请重试");
    return { ok: true };
  });
}
