import { ownerApi, body } from "@/lib/server/api";
import { importSubject } from "@/lib/server/library";
export function POST(req: Request) {
  return ownerApi(req, async (a) => importSubject(a, (await body(req)).subjectId));
}
