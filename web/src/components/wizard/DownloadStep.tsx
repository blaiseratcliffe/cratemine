"use client";

import { useState } from "react";

export function DownloadStep() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<
    "idle" | "resolving" | "downloading" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [trackInfo, setTrackInfo] = useState<{
    title: string;
    username: string;
    id: number;
  } | null>(null);

  function isValidSoundCloudUrl(input: string): boolean {
    try {
      const parsed = new URL(input);
      return (
        parsed.hostname === "soundcloud.com" ||
        parsed.hostname === "www.soundcloud.com" ||
        parsed.hostname === "m.soundcloud.com" ||
        parsed.hostname === "on.soundcloud.com"
      );
    } catch {
      return false;
    }
  }

  async function handleDownload() {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isValidSoundCloudUrl(trimmed)) {
      setError("Please enter a valid SoundCloud URL");
      setStatus("error");
      return;
    }

    setError("");
    setStatus("resolving");
    setTrackInfo(null);

    try {
      // Resolve the URL to get track info
      const resolveRes = await fetch("/api/sc/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!resolveRes.ok) {
        setError("Could not find that track. Check the URL and try again.");
        setStatus("error");
        return;
      }

      const data = await resolveRes.json();

      if (data.kind !== "track" || !data.track?.id) {
        setError(
          data.kind === "user"
            ? "That URL points to a user profile, not a track."
            : data.kind === "playlist"
              ? "That URL points to a playlist, not a track."
              : "URL does not point to a track."
        );
        setStatus("error");
        return;
      }

      const track = data.track;
      setTrackInfo({
        title: track.title || "Unknown",
        username: track.user?.username || "",
        id: track.id,
      });

      setStatus("downloading");

      // Download via our stream proxy
      const streamRes = await fetch(`/api/sc/tracks/${track.id}/stream`);
      if (!streamRes.ok) {
        const err = await streamRes.json().catch(() => null);
        setError(err?.error || "Download failed");
        setStatus("error");
        return;
      }

      const blob = await streamRes.blob();
      const disposition = streamRes.headers.get("Content-Disposition");
      let filename = `${track.username || "track"} - ${track.title || track.id}.mp3`;
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/);
        if (utf8Match) {
          filename = decodeURIComponent(utf8Match[1]);
        } else {
          const match = disposition.match(/filename="(.+?)"/);
          if (match) filename = match[1];
        }
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setStatus("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  const isLoading = status === "resolving" || status === "downloading";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Download Track</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Paste a SoundCloud track URL to download the audio.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (status === "error" || status === "done") setStatus("idle");
          }}
          placeholder="https://soundcloud.com/artist/track-name"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isLoading) handleDownload();
          }}
        />
        <button
          onClick={handleDownload}
          disabled={!url.trim() || isLoading}
          className="px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {status === "resolving" ? "Finding track..." : "Downloading..."}
            </span>
          ) : (
            "Download"
          )}
        </button>
      </div>

      {/* Track info */}
      {trackInfo && status !== "error" && (
        <div className="bg-zinc-900 rounded-lg p-4 flex items-center gap-3">
          <svg
            className="w-5 h-5 text-orange-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"
            />
          </svg>
          <div>
            <p className="text-white text-sm font-medium">{trackInfo.title}</p>
            {trackInfo.username && (
              <p className="text-zinc-400 text-xs">{trackInfo.username}</p>
            )}
          </div>
        </div>
      )}

      {/* Success */}
      {status === "done" && (
        <p className="text-sm text-green-400">Download complete.</p>
      )}

      {/* Error */}
      {status === "error" && error && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}
