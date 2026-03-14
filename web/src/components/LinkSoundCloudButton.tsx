"use client";

import { useState } from "react";

export function LinkSoundCloudButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLink() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/soundcloud/link", { method: "POST" });
      if (!res.ok) {
        setError("Failed to initiate SoundCloud link. Please try again.");
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleLink}
        disabled={loading}
        className="w-full px-8 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 text-white text-lg font-medium rounded-lg transition-colors cursor-pointer"
      >
        {loading ? "Connecting..." : "Connect with SoundCloud"}
      </button>
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
    </div>
  );
}
