import { ownerApi, body } from "@/lib/server/api";
import { addManual } from "@/lib/server/library";
import { readShelf } from "@/lib/server/journal";
export function GET(req: Request) {
  return ownerApi(req, readShelf);
}
export function POST(req: Request) {
  return ownerApi(req, async (a) => addManual(a, await body(req)));
}
