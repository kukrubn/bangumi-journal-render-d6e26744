import { redirect } from "next/navigation";
import { AppError } from "@/lib/domain/library";
import { requireOwner, serverDb } from "@/lib/supabase/server";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { BackupPanel } from "@/features/backup-panel";
import { SyncPanel } from "@/features/sync-panel";
import { InstallApp } from "@/features/pwa-install";
import "./settings.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置与数据 · 番剧手账" };
export default async function SettingsPage() {
  try {
    const actor = await requireOwner(await serverDb());
    return (
      <WorkspaceFrame view="settings" email={actor.email}>
        <div className="settings-page">
          <h1>设置与数据</h1>
          <SyncPanel />
          <BackupPanel />
          <InstallApp />
        </div>
      </WorkspaceFrame>
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 401) redirect("/login");
    if (e instanceof AppError && e.status === 403) redirect("/login?denied=1");
    throw e;
  }
}
