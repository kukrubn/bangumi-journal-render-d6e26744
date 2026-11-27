import { redirect } from "next/navigation";
import { AppError, shanghaiDay } from "@/lib/domain/library";
import { requireOwner, serverDb } from "@/lib/supabase/server";
import { projectConfig } from "@/lib/supabase/config";
import { developerConfig } from "@/lib/server/developer-auth";
import { readShelf } from "@/lib/server/journal";
import { Library } from "./library";

export async function CollectionPage({ view }: { view: "library" | "calendar" }) {
  if (!projectConfig() && !developerConfig()) redirect("/login");
  try {
    const actor = await requireOwner(await serverDb());
    const { entries, index } = await readShelf(actor);
    return (
      <Library
        initial={entries}
        initialIndex={index}
        initialDay={shanghaiDay()}
        view={view}
        ownerId={actor.uid}
        email={actor.email}
      />
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 401) redirect("/login");
    if (e instanceof AppError && e.status === 403) redirect("/login?denied=1");
    return (
      <main className="service-error">
        <h1>{view === "calendar" ? "放送周表" : "片单"}暂时无法打开</h1>
        <p>{e instanceof AppError ? e.message : "请检查网络后再试。"}</p>
        <a className="btn primary" href={"/" + view}>
          重新加载
        </a>
        <a className="btn neutral" href="/login">
          返回登录
        </a>
      </main>
    );
  }
}
