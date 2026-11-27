"use client";
import Link from "next/link";
import { Archive, CalendarDays, ChartColumn, Settings, LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { request, message } from "@/lib/client";
import { displayLoginName } from "@/lib/domain/member-login";

const pages = [
  { view: "library", name: "我的片单", short: "片单", icon: Archive },
  { view: "calendar", name: "放送周表", short: "周表", icon: CalendarDays },
  { view: "dashboard", name: "统计看板", short: "看板", icon: ChartColumn },
  { view: "settings", name: "设置与数据", short: "设置", icon: Settings },
] as const;
type View = (typeof pages)[number]["view"];
export function WorkspaceNav({
  view,
  mobile = false,
  onCurrent,
}: {
  view: View;
  mobile?: boolean;
  onCurrent?: () => void;
}) {
  return (
    <nav
      className={mobile ? "bottom-nav" : "view-nav"}
      aria-label={mobile ? "快捷操作" : "应用导航"}
    >
      {pages.map(({ view: key, name, short, icon: Icon }) => (
        <Link
          key={key}
          href={"/" + key}
          aria-current={view === key ? "page" : undefined}
          onClick={view === key ? onCurrent : undefined}
        >
          <Icon size={mobile ? 19 : 17} />
          {mobile ? short : name}
        </Link>
      ))}
    </nav>
  );
}
export function WorkspaceFrame({
  view,
  email,
  children,
}: {
  view: View;
  email: string;
  children: ReactNode;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await request("/api/auth/logout", "POST", {});
      window.location.replace("/login");
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <div className="library-page">
      <header className="shell-head">
        <div className="head-inner">
          <Brand />
          <div className="header-tools">
            <span className="account">{displayLoginName(email)}</span>
            <ThemeToggle />
            <button className="icon-btn" disabled={busy} onClick={logout} aria-label="退出登录">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <div className="shell">
        <aside className="side">
          <WorkspaceNav view={view} />
        </aside>
        <main className="library-main">
          {error && (
            <p role="alert" className="warn-line">
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
      <WorkspaceNav view={view} mobile />
    </div>
  );
}
