import { uuid } from "@/lib/domain/library";
import { body, ownerApi, type EntryRoute } from "@/lib/server/api";
import { syncSchedule } from "@/lib/server/journal";

export function POST(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) =>
    syncSchedule(a, uuid((await ctx.params).id), (await body(req)).force === true),
  );
}
