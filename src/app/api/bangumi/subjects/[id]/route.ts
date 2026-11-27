import { ownerApi, type EntryRoute } from "@/lib/server/api";
import { parseSubjectId } from "@/lib/domain/bangumi";
import { getSubject } from "@/lib/server/bangumi";
export function GET(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async ({ db }) => ({
    subject: await getSubject(db, parseSubjectId((await ctx.params).id)),
  }));
}
