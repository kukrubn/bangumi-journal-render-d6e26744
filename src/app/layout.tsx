import type { Metadata, Viewport } from "next";
import { PwaProvider } from "@/features/pwa-install";
import "./globals.css";
import "./journal.css";
import "./dashboard.css";
export const metadata: Metadata = {
  title: "番剧手账",
  description: "个人追番片单与观看记录",
  applicationName: "番剧手账",
  appleWebApp: { capable: true, title: "番剧手账", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#185549" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}
