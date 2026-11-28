"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallState = {
  start?: () => Promise<void>;
  installed: boolean;
  androidBrowser: boolean;
  hint: string;
};
const InstallContext = createContext<InstallState>({
  installed: false,
  androidBrowser: false,
  hint: "可在浏览器菜单中安装到设备。",
});

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [androidBrowser, setAndroidBrowser] = useState(false);
  const [hint, setHint] = useState("可在浏览器菜单中安装到设备。");
  useEffect(() => {
    const ua = navigator.userAgent;
    const androidApp = ua.includes("BangumiJournalAndroid/");
    setAndroidBrowser(/Android/i.test(ua) && !androidApp);
    const mode = window.matchMedia("(display-mode: standalone)");
    const inApp = () =>
      setInstalled(
        androidApp ||
          mode.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    inApp();
    mode.addEventListener("change", inApp);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    let active = true;
    if (!window.isSecureContext) {
      setHint("手机安装请通过 HTTPS 打开此应用；电脑本机可用 localhost。");
    } else if ("serviceWorker" in navigator) {
      const ios =
        /iPad|iPhone|iPod/i.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (ios) setHint("在 Safari 的分享菜单点“添加到主屏幕”，如有“作为网页 App 打开”，请启用。");
      else if (/Macintosh.*Safari/i.test(ua) && !/Chrom(e|ium)|Edg/i.test(ua))
        setHint("在 Safari 的“文件”或分享菜单中选“添加到程序坞”。");
      else setHint("在浏览器地址栏或菜单中选择“安装应用”或“添加到主屏幕”。");
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          if (active) setHint("离线页面注册失败，请连接网络后刷新。");
        });
    } else setHint("请用支持安装的浏览器打开，例如 Edge、Chrome 或 Safari。");
    return () => {
      active = false;
      mode.removeEventListener("change", inApp);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  async function start() {
    if (!prompt) return;
    setPrompt(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setHint("安装已提交，可在设备的应用列表查看。");
    } catch {
      setHint("请通过浏览器菜单完成安装。");
    }
  }
  return (
    <InstallContext.Provider
      value={{ installed, androidBrowser, hint, start: prompt ? start : undefined }}
    >
      {children}
    </InstallContext.Provider>
  );
}

export function InstallApp() {
  const { start, hint, installed, androidBrowser } = useContext(InstallContext);
  return (
    <section className="install-panel" aria-label="应用安装">
      <h2>{installed ? "应用已安装" : "安装到设备"}</h2>
      {!installed && <p>{hint}</p>}
      {!installed && (androidBrowser || start) && (
        <div className="actions">
          {androidBrowser && (
            <a className="btn primary" href="/downloads/bangumi-journal-android.apk" download>
              <Download size={16} />
              下载安卓版 APK
            </a>
          )}
          {start && (
            <button
              className={androidBrowser ? "btn neutral" : "btn primary"}
              type="button"
              onClick={() => void start()}
            >
              <Download size={16} />
              {androidBrowser ? "安装网页版" : "安装番剧手账"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
