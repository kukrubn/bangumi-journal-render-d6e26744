"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppError, type Entry } from "@/lib/domain/library";
import { scheduleFresh } from "@/lib/domain/schedule";
import { message, request } from "@/lib/client";

export function useScheduleSync(entries: Entry[], paused: boolean, refresh: () => Promise<void>) {
  const [active, setActive] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(null);
  const attempts = useRef(new Map<string, number>());
  const upstreamRetryAt = useRef(0);
  const current = useRef<{ id: string; task: Promise<void> } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const sync = useCallback(
    async (e: Entry, force = true): Promise<void> => {
      if (current.current) {
        if (current.current.id === e.id) return current.current.task;
        await current.current.task.catch(() => {});
        return sync(e, force);
      }
      setActive(e.id);
      attempts.current.set(e.id, Date.now() + 5 * 60000);
      const task = (async () => {
        try {
          if (!e.metadata_fetched_at) {
            try {
              await request("/api/library/" + e.id + "/metadata", "POST", {});
            } catch (error) {
              if (!(error instanceof AppError) || ![404, 422].includes(error.status)) throw error;
            }
          }
          await request("/api/library/" + e.id + "/schedule", "POST", { force });
          if (mounted.current) {
            await refresh();
            setFailure((prev) => (prev?.id === e.id ? null : prev));
          }
        } catch (error) {
          if (mounted.current) setFailure({ id: e.id, text: message(error) });
          if (error instanceof AppError && error.status === 429) {
            upstreamRetryAt.current = Date.now() + Math.max(2, error.retryAfter ?? 2) * 1000;
            attempts.current.set(
              e.id,
              Math.max(attempts.current.get(e.id) ?? 0, upstreamRetryAt.current),
            );
          }
          throw error;
        } finally {
          current.current = null;
          if (mounted.current) setActive(null);
        }
      })();
      current.current = { id: e.id, task };
      return task;
    },
    [refresh],
  );
  useEffect(() => {
    if (paused || active || current.current || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now < upstreamRetryAt.current) return;
    const candidates = entries.filter(
      (e) => e.bangumi_id && !scheduleFresh(e, now) && (attempts.current.get(e.id) ?? 0) <= now,
    );
    const priority = (e: Entry) =>
      e.watch_status === "watching" ? 0 : e.watch_status === "planned" ? 1 : 2;
    const next = candidates.sort((a, b) => priority(a) - priority(b))[0];
    if (!next) return;
    const timer = setTimeout(() => {
      void sync(next, false).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [entries, paused, active, sync]);
  return { active, failure, sync };
}
