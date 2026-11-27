"use client";
import { Input } from "@/components/ui/input";
import { useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { AccountLayout } from "@/components/account-layout";
import { PasswordField } from "@/components/password-field";
import { message, request } from "@/lib/client";
export function Login({
  configured,
  notice,
  dual,
}: {
  configured: boolean;
  notice: string;
  dual: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(notice);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request("/api/auth/login", "POST", {
        email: fd.get("email"),
        password: fd.get("password"),
        mode: fd.get("mode"),
      });
      window.location.replace("/library");
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }
  return (
    <AccountLayout>
      <h1>登录片单</h1>
      <p className="lede">在电脑和手机上继续你的观看记录。</p>
      {!configured && (
        <p className="config-note">
          首次运行请复制 <code>.env.local.example</code> 为 <code>.env.local</code>，填写 Supabase
          项目地址和公开密钥，或运行 <code>npm run account:setup -- 邮箱</code>{" "}
          配置本机开发者账号，然后重启。
        </p>
      )}
      <form onSubmit={submit} className="login-form">
        {dual && (
          <label>
            片单来源
            <select name="mode" defaultValue="developer">
              <option value="developer">开发者片单</option>
              <option value="cloud">Supabase 云端片单</option>
            </select>
          </label>
        )}
        <label>
          邮箱或登录号
          <Input
            required
            name="email"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="username"
            placeholder="输入邮箱或 bj- 开头的登录号"
          />
        </label>
        <PasswordField />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={!configured || busy} className="btn primary login-submit">
          {busy && <LoaderCircle className="spin" size={16} />}登录
        </button>
      </form>
      <p className="privacy">
        <LockKeyhole size={14} /> 登录后即可访问自己的片单
      </p>
    </AccountLayout>
  );
}
