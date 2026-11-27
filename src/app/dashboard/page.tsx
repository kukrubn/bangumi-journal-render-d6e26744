import { redirect } from "next/navigation";
import { AppError } from "@/lib/domain/library";
import { readDashboard } from "@/lib/server/dashboard";
import { requireOwner, serverDb } from "@/lib/supabase/server";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { Dashboard } from "@/features/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "统计看板 · 番剧手账" };
export default async function DashboardPage() {
  try {
    const actor = await requireOwner(await serverDb());
    const data = await readDashboard(actor);
    return (
      <WorkspaceFrame view="dashboard" email={actor.email}>
        <Dashboard initial={data} />
      </WorkspaceFrame>
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    if (error instanceof AppError && error.status === 403) redirect("/login?denied=1");
    return (
      <main className="service-error">
        <h1>看板暂时无法打开</h1>
        <p>{error instanceof AppError ? error.message : "请检查连接并重新加载。"}</p>
        <a className="btn primary" href="/dashboard">
          重新加载
        </a>
        <a className="btn neutral" href="/library">
          返回片单
        </a>
      </main>
    );
  }
}
