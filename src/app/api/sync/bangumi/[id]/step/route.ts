import { body, ownerApi, type EntryRoute } from "@/lib/server/api";
import { uuid } from "@/lib/domain/library";
import { stepRun } from "@/lib/server/collection";

export const maxDuration = 60;
export function POST(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (actor) =>
    stepRun(actor, uuid((await ctx.params).id), await body(req)),
  );
}
