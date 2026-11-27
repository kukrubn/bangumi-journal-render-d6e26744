import { body, ownerApi } from "@/lib/server/api";
import { readDashboard, saveMinutes } from "@/lib/server/dashboard";
export function GET(req: Request) {
  return ownerApi(req, readDashboard);
}
export function PATCH(req: Request) {
  return ownerApi(req, async (actor) => saveMinutes(actor, await body(req)));
}
