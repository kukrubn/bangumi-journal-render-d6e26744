import { AppError, uuid } from "@/lib/domain/library";
import { body, ownerApi } from "@/lib/server/api";
import { developerConfig } from "@/lib/server/developer-auth";
import { createInvite, listInvites, revokeInvite } from "@/lib/server/member-store";
import { canManageInvites, type Owner } from "@/lib/supabase/server";

function databaseFor(actor: Owner) {
  const config = developerConfig();
  if (!canManageInvites(actor) || !config?.database)
    throw new AppError(403, "只有站点管理员可以管理邀请");
  return config.database;
}
export function GET(req: Request) {
  return ownerApi(req, async (actor) => ({
    invites: await listInvites(databaseFor(actor), actor.uid),
  }));
}
export function POST(req: Request) {
  return ownerApi(req, async (actor) => {
    const database = databaseFor(actor);
    await body(req);
    return createInvite(database, actor.uid);
  });
}
export function DELETE(req: Request) {
  return ownerApi(req, async (actor) => {
    const database = databaseFor(actor);
    const { id } = await body(req);
    await revokeInvite(database, actor.uid, uuid(id));
    return { ok: true };
  });
}
