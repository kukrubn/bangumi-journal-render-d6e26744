import { uuid } from "@/lib/domain/library";
import { body, ownerApi, type EntryRoute } from "@/lib/server/api";
import { changeJournal } from "@/lib/server/journal";

function change(req: Request, ctx: EntryRoute) {
  return ownerApi(req, async (a) =>
    changeJournal(a, uuid((await ctx.params).id), req.method, await body(req)),
  );
}
export { change as POST, change as PATCH, change as DELETE };
