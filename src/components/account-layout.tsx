import type { ReactNode } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main className="login-page">
      <div className="login-art">
        <img
          src="/art/login-station.webp"
          alt="黄昏海边车站停靠着一辆通勤列车"
          fetchPriority="high"
        />
      </div>
      <section className="login-side">
        <header className="login-header">
          <Brand />
          <ThemeToggle />
        </header>
        <div className="login-box">
          <div className="title-rule" />
          {children}
        </div>
      </section>
    </main>
  );
}
