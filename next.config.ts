import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  outputFileTracingExcludes: { "/*": ["./.journal-local/**/*", "./.env*"] },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path((?:api|calendar|library|login|join|dashboard|settings)(?:/.*)?)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/downloads/bangumi-journal-android.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="bangumi-journal-android.apk"' },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; connect-src 'self'",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};
export default config;
