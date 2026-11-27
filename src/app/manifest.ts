import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "番剧手账",
    short_name: "番剧手账",
    lang: "zh-CN",
    description: "个人追番片单、放送周表、备忘录与观看统计",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f2",
    theme_color: "#185549",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
