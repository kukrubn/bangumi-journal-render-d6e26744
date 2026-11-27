import { projectConfig } from "@/lib/supabase/config";
import { developerConfig } from "@/lib/server/developer-auth";
import { Login } from "@/features/login";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  return (
    <Login
      configured={!!projectConfig() || !!developerConfig()}
      dual={!!projectConfig() && !!developerConfig()}
      notice={
        p.denied
          ? "此账号未绑定到这份片单，请使用本人账号登录。"
          : p.expired
            ? "会话已过期，请重新登录。"
            : ""
      }
    />
  );
}
