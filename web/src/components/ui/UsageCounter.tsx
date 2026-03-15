"use client";

import { useEffect, useState } from "react";

interface UsageData {
  used: number;
  limit: number; // 0 = unlimited
}

export function UsageCounter({ type }: { type: "playlistSearch" | "sceneDiscovery" }) {
  const [data, setData] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => setData(d[type]))
      .catch(() => {});
  }, [type]);

  if (!data || data.limit === 0) return null;

  const remaining = Math.max(0, data.limit - data.used);

  return (
    <span
      className={`text-xs ${
        remaining === 0
          ? "text-red-400"
          : remaining <= 1
            ? "text-amber-400"
            : "text-zinc-500"
      }`}
    >
      {remaining}/{data.limit} remaining today
    </span>
  );
}
