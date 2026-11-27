"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let choice: string | null = null;
      try {
        choice = localStorage.getItem("journal-theme");
      } catch {}
      const mode = choice ? choice === "dark" : media.matches;
      document.documentElement.dataset.theme = mode ? "dark" : "light";
      setDark(mode);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  function toggle() {
    const mode = !dark;
    try {
      localStorage.setItem("journal-theme", mode ? "dark" : "light");
    } catch {}
    document.documentElement.dataset.theme = mode ? "dark" : "light";
    setDark(mode);
  }
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={dark ? "切换浅色模式" : "切换深色模式"}
      title={dark ? "切换浅色模式" : "切换深色模式"}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
