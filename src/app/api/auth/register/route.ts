import { AppError } from "@/lib/domain/library";
import { displayLoginName } from "@/lib/domain/member-login";
import { body, jsonApi } from "@/lib/server/api";
import { hashPassword, inviteHash, registrationEmail } from "@/lib/server/account-credentials";
import { developerConfig, setDeveloperSession } from "@/lib/server/developer-auth";
import { checkInvite, redeemInvite } from "@/lib/server/member-store";
import { requireOwner, serverDb } from "@/lib/supabase/server";

export function POST(req: Request) {
  return jsonApi(req, async (headers) => {
    const config = developerConfig();
    if (!config?.database) throw new AppError(403, "当前站点未启用邀请注册");
    try {
      await requireOwner(await serverDb(headers));
      throw new AppError(409, "当前已登录，请先退出，再使用邀请注册新账号");
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
    }
    const input = await body(req);
    if (typeof input.password !== "string") throw new AppError(422, "请设置登录密码");
    const hash = inviteHash(input.token);
    await checkInvite(config.database, hash);
    const email = registrationEmail(input.email, hash, config.email);
    const passwordHash = await hashPassword(input.password);
    const account = await redeemInvite(config.database, hash, email, passwordHash);
    await setDeveloperSession(req, config, account);
    return { ok: true, loginName: displayLoginName(email) };
  });
}
