import "server-only";
import { NextResponse } from "next/server";
import { AppError, record } from "@/lib/domain/library";
import { requireOwner, serverDb, type Db, type Owner } from "@/lib/supabase/server";

export async function body(req: Request) {
  try {
    return record(await req.json());
  } catch {
    throw new AppError(400, "请求须为 JSON 对象");
  }
}
export async function api(req: Request, fn: (db: Db) => Promise<unknown>) {
  return jsonApi(req, async (headers) => fn(await serverDb(headers)));
}
export async function jsonApi(req: Request, fn: (headers: Headers) => Promise<unknown>) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    Expires: "0",
  });
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.get("origin");
      if (
        req.headers.get("sec-fetch-site") === "cross-site" ||
        (origin &&
          new URL(origin).host !== new URL(req.url).host &&
          new URL(origin).host !== req.headers.get("host"))
      )
        throw new AppError(403, "请求来源无效");
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        throw new AppError(415, "请使用 JSON 请求");
    }
    return NextResponse.json(await fn(headers), { headers });
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError(500, "请求未完成，请稍后重试");
    if (e.retryAfter) headers.set("Retry-After", String(e.retryAfter));
    return NextResponse.json({ error: e.message }, { status: e.status, headers });
  }
}
export function ownerApi(req: Request, fn: (actor: Owner) => Promise<unknown>) {
  return api(req, async (db) => fn(await requireOwner(db)));
}
export type EntryRoute = { params: Promise<{ id: string }> };
