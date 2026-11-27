import { body, ownerApi } from "@/lib/server/api";
import { AppError, integer, optionalText } from "@/lib/domain/library";
import { searchSubjects } from "@/lib/server/bangumi";
export function POST(req: Request) {
  return ownerApi(req, async ({ db }) => {
    const p = await body(req),
      keyword = optionalText(p.keyword);
    if (!keyword || keyword.length > 160) throw new AppError(422, "搜索词须为 1–160 个字符");
    return searchSubjects(db, keyword, integer(p.offset, 0, 2147483647, "分页位置") ?? 0);
  });
}
