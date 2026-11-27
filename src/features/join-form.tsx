"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/password-field";
import { message, request } from "@/lib/client";
import { generatedLoginName } from "@/lib/domain/member-login";

export function JoinForm() {
  const [token, setToken] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState("");
  const [loginName, setLoginName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function readLink() {
      const fragment = window.location.hash.slice(1);
      setToken(/^[A-Za-z0-9_-]{43}$/.test(fragment) ? fragment : "");
      setError("");
    }
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  useEffect(() => {
    let current = true;
    setLoginHint("");
    if (token && window.crypto.subtle) {
      void crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(token))
        .then((buffer) => {
          const digest = Array.from(new Uint8Array(buffer), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          if (current) setLoginHint(generatedLoginName(digest));
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const result = await request<{ loginName: string }>("/api/auth/register", "POST", {
        token,
        password: fields.get("password"),
        email: String(fields.get("email") || "").trim() || undefined,
      });
      setLoginName(result.loginName);
      history.replaceState(history.state, "", location.pathname);
      setToken(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (loginName)
    return (
      <>
        <h1>你的片单已创建</h1>
        <p className="lede">保存下面的登录名。下次换设备，用它和刚设置的密码登录。</p>
        <label>
          登录名
          <Input value={loginName} readOnly onFocus={(e) => e.target.select()} />
        </label>
        <div className="join-actions">
          <a className="btn primary" href="/library">
            进入我的片单
          </a>
          <button
            type="button"
            className="btn neutral"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(loginName);
                setCopied(true);
              } catch {
                setError("请选中上方登录名，手动复制。");
              }
            }}
          >
            <Copy size={16} />
            {copied ? "已复制" : "复制登录名"}
          </button>
        </div>
        {error && <p role="status">{error}</p>}
      </>
    );
  if (token === null)
    return (
      <p className="lede" role="status">
        正在打开邀请…
      </p>
    );
  if (!token)
    return (
      <>
        <h1>需要完整的邀请链接</h1>
        <p className="lede">请让邀请人重新复制完整链接发给你。已有账号可以直接登录。</p>
        <Link href="/login" className="btn neutral">
          前往登录
        </Link>
      </>
    );
  return (
    <>
      <h1>创建你的片单</h1>
      <p className="lede">朋友邀请你加入番剧手账。设置密码后，就能开始记录自己的追番进度。</p>
      <form className="login-form" onSubmit={submit}>
        <PasswordField create />
        <details className="join-email">
          <summary>使用邮箱作为登录名（可选）</summary>
          <label>
            登录邮箱
            <Input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              maxLength={254}
              placeholder="you@example.com"
            />
          </label>
        </details>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="btn primary login-submit" disabled={busy}>
          {busy && <LoaderCircle className="spin" size={16} />}创建片单
        </button>
      </form>
      {loginHint && (
        <p className="join-help">
          使用自动分配的登录号 <strong>{loginHint}</strong>{" "}
          或填写自己的邮箱，今后可在手机和电脑上登录。
        </p>
      )}
      <Link href="/login" className="text-button">
        已有账号，前往登录
      </Link>
    </>
  );
}
