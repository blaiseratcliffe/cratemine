"use client";

import { useState } from "react";

export function LinkSoundCloudButton() {
  const [loading, setLoading] = useState(false);

  async function handleLink() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/soundcloud/link", { method: "POST" });
      if (!res.ok) {
        alert("Failed to initiate SoundCloud link");
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleLink}
      disabled={loading}
      className="w-full px-8 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 text-white text-lg font-medium rounded-lg transition-colors cursor-pointer"
    >
      {loading ? "Connecting..." : "Connect with SoundCloud"}
    </button>
  );
}
