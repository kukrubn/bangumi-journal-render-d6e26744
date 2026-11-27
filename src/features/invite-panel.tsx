"use client";
import { useEffect, useState } from "react";
import { Copy, Link2, UserPlus } from "lucide-react";
import { message, request } from "@/lib/client";

interface Invitation {
  id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}
function status(invite: Invitation) {
  if (invite.used_at) return "已使用";
  if (invite.revoked_at) return "已撤销";
  if (Date.parse(invite.expires_at) <= Date.now()) return "已过期";
  return "待使用";
}
const time = (stamp: string) =>
  new Date(stamp).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function InvitePanel() {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function refresh(signal?: AbortSignal) {
    const data = await request<{ invites: Invitation[] }>("/api/invites", "GET", undefined, signal);
    if (!signal?.aborted) setRows(data.invites);
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(message(e));
    });
    return () => controller.abort();
  }, []);

  async function change(id?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (id) {
        await request("/api/invites", "DELETE", { id });
        if (fresh?.id === id) setFresh(null);
      } else {
        const result = await request<{ id: string; token: string }>("/api/invites", "POST", {});
        setFresh({ id: result.id, url: window.location.origin + "/join#" + result.token });
        setCopied(false);
      }
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="invite-panel" aria-labelledby="invites-title">
      <h2 id="invites-title">
        <UserPlus size={21} />
        邀请朋友
      </h2>
      <p>每条链接可供一位朋友注册，7 天内有效。朋友会获得自己的空片单。</p>
      <button className="btn primary" disabled={busy} onClick={() => change()}>
        <Link2 size={17} />
        生成邀请链接
      </button>
      {fresh && (
        <div className="invite-share">
          <label>
            发给朋友的链接
            <input
              value={fresh.url}
              readOnly
              spellCheck={false}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            type="button"
            className="btn neutral"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fresh.url);
                setCopied(true);
              } catch {
                setError("请选中邀请链接并手动复制。");
              }
            }}
          >
            <Copy size={16} />
            {copied ? "已复制" : "复制链接"}
          </button>
          <small>请在离开本页前复制链接。</small>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => {
              setError("");
              refresh().catch((e) => setError(message(e)));
            }}
          >
            刷新记录
          </button>
        </p>
      )}
      {rows.length > 0 && (
        <ul aria-label="近期邀请" className="invite-list">
          {rows.map((item) => {
            const state = status(item);
            return (
              <li key={item.id}>
                <div>
                  <strong>{state}</strong>
                  <span>
                    {time(item.created_at)} 创建
                    {state === "待使用" && " · " + time(item.expires_at) + " 到期"}
                  </span>
                </div>
                {state === "待使用" && (
                  <button
                    type="button"
                    className="btn neutral small"
                    disabled={busy}
                    aria-label={"撤销 " + time(item.created_at) + " 创建的邀请"}
                    onClick={() => change(item.id)}
                  >
                    撤销
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
