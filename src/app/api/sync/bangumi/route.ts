import { body, ownerApi } from "@/lib/server/api";
import { recentRuns, startRun } from "@/lib/server/collection";

export function GET(req: Request) {
  return ownerApi(req, recentRuns);
}
export function POST(req: Request) {
  return ownerApi(req, async (actor) => startRun(actor, await body(req)));
}
