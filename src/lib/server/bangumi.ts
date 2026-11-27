import "server-only";
import { AppError, shanghaiDay } from "@/lib/domain/library";
import { calendarDays, normalizeSubject, preview, type SubjectPreview } from "@/lib/domain/bangumi";
import { databaseError, type Db } from "@/lib/supabase/server";
import { collectEpisodes } from "@/lib/domain/schedule";

const host = "https://api.bgm.tv";
const cache = new Map<string, { expires: number; value: unknown }>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function retrySeconds(raw: string | null) {
  if (!raw) return 0;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(2147483647, Math.ceil(seconds))) : 0;
}
async function slot(db: Db) {
  const until = Date.now() + 2600;
  for (;;) {
    const { data, error } = await db.rpc("bangumi_request_slot", { p_backoff_seconds: 0 }).single();
    if (error) databaseError(error);
    if (data.granted) return;
    const ms = Math.max(50, Date.parse(data.retry_at) - Date.now() + 35);
    if (!Number.isFinite(ms) || Date.now() + ms > until)
      throw new AppError(
        429,
        "Bangumi 请求较多，请稍后重试",
        Math.max(1, Math.ceil(ms / 1000)) || 2,
      );
    await sleep(ms);
  }
}
async function upstream(db: Db, path: string, ttl: number, payload?: object): Promise<unknown> {
  const key = path + JSON.stringify(payload ?? null),
    hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const ua = process.env.BANGUMI_USER_AGENT?.trim();
  if (!ua) throw new AppError(503, "请在 .env.local 中配置 BANGUMI_USER_AGENT 并重启");
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot(db);
    let res: Response | undefined;
    try {
      res = await fetch(host + path, {
        method: payload ? "POST" : "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": ua,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch {
      /* Timeout or unavailable network. Retry reads only. */
    }
    if (res?.ok) {
      let value: unknown;
      try {
        value = await res.json();
      } catch {
        throw new AppError(502, "Bangumi 返回了无法解析的资料");
      }
      if (ttl > 0) {
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, expires: Date.now() + ttl });
      }
      return value;
    }
    if (res?.status === 404) throw new AppError(404, "Bangumi 条目不存在或不可见");
    const backoff =
      retrySeconds(res?.headers.get("retry-after") ?? null) || (res?.status === 429 ? 2 : 0);
    if (backoff && res && (res.status === 429 || res.status >= 500)) {
      const { error } = await db.rpc("bangumi_request_slot", { p_backoff_seconds: backoff });
      if (error) databaseError(error);
      if (backoff > 2 || attempt === 2)
        throw new AppError(429, "Bangumi 正在限流，请稍后重试", backoff);
    } else if (res && res.status < 500 && res.status !== 408)
      throw new AppError(502, "Bangumi 未接受此请求，请检查 User-Agent 或改用手动添加");
    if (attempt < 2)
      await sleep(Math.max(backoff * 1000, 300 * 2 ** attempt) + Math.random() * 140);
  }
  throw new AppError(502, "暂时无法连接 Bangumi，请重试或手动添加");
}
export function mainEpisodes(db: Db, subject: number) {
  return collectEpisodes(subject, (offset) =>
    upstream(db, "/v0/episodes?subject_id=" + subject + "&type=0&limit=100&offset=" + offset, 0),
  );
}
export async function collectionPage(db: Db, username: string, offset: number) {
  try {
    return await upstream(
      db,
      "/v0/users/" +
        encodeURIComponent(username) +
        "/collections?subject_type=2&limit=20&offset=" +
        offset,
      0,
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 404)
      throw new AppError(404, "Bangumi 用户不存在或其收藏不可见");
    throw error;
  }
}
export async function calendarWeekday(db: Db, id: number) {
  try {
    return calendarDays(await upstream(db, "/calendar", 3600000))[id] ?? null;
  } catch (e) {
    if (!(e instanceof AppError) || e.status === 401 || e.status === 403) throw e;
    return null;
  }
}
export async function searchSubjects(db: Db, keyword: string, offset: number) {
  const raw = await upstream(db, "/v0/search/subjects?limit=12&offset=" + offset, 300000, {
    keyword,
    sort: "match",
    filter: { type: [2] },
  });
  const page = raw as { data?: unknown[]; total?: number };
  if (!page || !Array.isArray(page.data)) throw new AppError(502, "Bangumi 搜索结果格式已变化");
  const data = page.data.map(preview).filter((s): s is SubjectPreview => !!s);
  return {
    data,
    nextOffset:
      page.data.length >= 12 && offset + 12 < (page.total ?? Infinity) ? offset + 12 : null,
  };
}
export async function getSubjectMetadata(db: Db, id: number) {
  const raw = await upstream(db, "/v0/subjects/" + id, 6 * 3600000);
  const subject = normalizeSubject(raw);
  if (subject.bangumi_id !== id) throw new AppError(502, "Bangumi 返回了不同的条目 ID");
  return subject;
}
export async function getSubject(db: Db, id: number) {
  const subject = await getSubjectMetadata(db, id);
  const today = shanghaiDay();
  if (subject.end_date && subject.end_date <= today) return subject;
  const weekday = await calendarWeekday(db, id);
  return weekday
    ? {
        ...subject,
        air_weekday: weekday,
        release_pattern: "weekly" as const,
        calendar_seen_on: today,
      }
    : subject;
}
