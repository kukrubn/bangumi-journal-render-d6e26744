export function projectConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  // A shared developer database is a single-owner installation, including on machines with old Supabase env files.
  if (env.JOURNAL_DATABASE_URL?.trim()) return null;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return null;
    if (!key.startsWith("sb_publishable_")) {
      const parts = key.split(".");
      if (
        parts.length !== 3 ||
        JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role !== "anon"
      )
        return null;
    }
    return { url: u.origin, key };
  } catch {
    return null;
  }
}
export function isProjectAuthCookie(url: string, name: string) {
  const base = "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token";
  return (
    name === base || (name.startsWith(base + ".") && /^\d+$/.test(name.slice(base.length + 1)))
  );
}
