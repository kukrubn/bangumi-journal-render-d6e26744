import { AppError, type Entry } from "@/lib/domain/library";
export type Saved = {
  entry: Entry;
  suggestCompletion?: boolean;
  created?: boolean;
  advanced?: boolean;
};
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
    signal,
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result) {
    if (res.status === 401 && !path.startsWith("/api/auth/"))
      window.location.assign("/login?expired=1");
    throw new AppError(
      res.status,
      result?.error || "网络请求未完成，请重试",
      Number(res.headers.get("Retry-After")) || undefined,
    );
  }
  return result as T;
}
export function message(e: unknown) {
  return e instanceof AppError ? e.message : "网络连接中断，请重试";
}
export function operationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-");
}
