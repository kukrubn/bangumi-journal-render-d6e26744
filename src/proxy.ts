import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { projectConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = projectConfig();
  if (!config) return response;
  const db = createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies, headers) {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        const next = NextResponse.next({ request });
        for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);
        for (const key of ["cache-control", "expires", "pragma"]) {
          const value = response.headers.get(key);
          if (value) next.headers.set(key, value);
        }
        for (const { name, value, options } of cookies) next.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) next.headers.set(key, value);
        response = next;
      },
    },
  });
  await db.auth.getClaims();
  return response;
}
export const config = {
  matcher: [
    "/library/:path*",
    "/calendar/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/api/:path*",
  ],
};
