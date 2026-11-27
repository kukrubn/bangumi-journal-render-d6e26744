import { body, ownerApi, type EntryRoute } from "@/lib/server/api";
import { deleteEntry, editEntry } from "@/lib/server/library";
import { uuid } from "@/lib/domain/library";
export function PATCH(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) => editEntry(a, uuid((await ctx.params).id), await body(req)));
}
export function DELETE(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) =>
    deleteEntry(a, uuid((await ctx.params).id), (await body(req)).version),
  );
}
