import { body, ownerApi, type EntryRoute } from "@/lib/server/api";
import { increment } from "@/lib/server/library";
import { uuid } from "@/lib/domain/library";
export function POST(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) =>
    increment(a, uuid((await ctx.params).id), (await body(req)).requestId),
  );
}
