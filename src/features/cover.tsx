"use client";
import { useState } from "react";
import { Film } from "lucide-react";
export function Cover({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && url !== failed ? (
    <img
      src={url}
      alt={name + " 封面"}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(url)}
    />
  ) : (
    <span className="cover-fallback" aria-label={name + " 暂无封面"}>
      <Film size={28} strokeWidth={1.4} />
    </span>
  );
}
