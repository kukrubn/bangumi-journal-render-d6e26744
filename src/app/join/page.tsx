import Link from "next/link";
import { AccountLayout } from "@/components/account-layout";
import { JoinForm } from "@/features/join-form";
import { AppError } from "@/lib/domain/library";
import { displayLoginName } from "@/lib/domain/member-login";
import { developerConfig } from "@/lib/server/developer-auth";
import { serverDb, requireOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "好友邀请 · 番剧手账",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function JoinPage() {
  let loginName = "";
  const enabled = Boolean(developerConfig()?.database);
  if (enabled) {
    try {
      loginName = displayLoginName((await requireOwner(await serverDb())).email);
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
    }
  }
  return (
    <AccountLayout>
      {loginName ? (
        <>
          <h1>你已登录</h1>
          <p className="lede">
            当前账号为 {loginName}。如需为朋友注册，请让对方在自己的浏览器打开邀请链接。
          </p>
          <Link className="btn primary" href="/library">
            进入我的片单
          </Link>
        </>
      ) : enabled ? (
        <JoinForm />
      ) : (
        <>
          <h1>此站点未开放邀请</h1>
          <Link href="/login" className="text-button">
            返回登录
          </Link>
        </>
      )}
    </AccountLayout>
  );
}
