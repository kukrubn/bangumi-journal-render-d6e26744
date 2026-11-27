import { uuid } from "@/lib/domain/library";
import { ownerApi, type EntryRoute } from "@/lib/server/api";
import { completeCollectionMetadata } from "@/lib/server/collection";

export const maxDuration = 60;
export function POST(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) => completeCollectionMetadata(a, uuid((await ctx.params).id)));
}
