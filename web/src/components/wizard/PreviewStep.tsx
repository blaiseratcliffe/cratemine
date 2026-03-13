"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScoredTrack, ScoringWeights } from "@/types";
import { mergeTracks } from "@/lib/soundcloud/scoring";

interface Props {
  tracks: ScoredTrack[];
  mergedTracks: ScoredTrack[];
  weights: ScoringWeights;
  maxTracks: number;
  onWeightsChange: (weights: ScoringWeights) => void;
  onMaxTracksChange: (max: number) => void;
  onMergedTracksChange: (tracks: ScoredTrack[]) => void;
  onBack: () => void;
  onNext: () => void;
}

type SortField =
  | "title"
  | "username"
  | "playbackCount"
  | "likesCount"
  | "repostsCount"
  | "score"
  | "createdAt";
type SortDir = "asc" | "desc";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PreviewStep({
  tracks,
  mergedTracks,
  weights,
  maxTracks,
  onWeightsChange,
  onMaxTracksChange,
  onMergedTracksChange,
  onBack,
  onNext,
}: Props) {
  const [playingTrackId, setPlayingTrackId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Recompute merged tracks when weights or maxTracks change
  useEffect(() => {
    const result = mergeTracks(tracks, weights, maxTracks);
    onMergedTracksChange(result);
  }, [tracks, weights, maxTracks, onMergedTracksChange]);

  const sortedTracks = useMemo(() => {
    const sorted = [...mergedTracks].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "username":
          cmp = a.username.localeCompare(b.username);
          break;
        case "createdAt":
          cmp =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        default:
          cmp = a[sortField] - b[sortField];
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [mergedTracks, sortField, sortDir]);

  const dedupCount = tracks.length - mergedTracks.length;

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "title" || field === "username" ? "asc" : "desc");
    }
  }

  function handlePlay(track: ScoredTrack) {
    if (playingTrackId === track.trackId) {
      setPlayingTrackId(null);
    } else {
      setPlayingTrackId(track.trackId);
    }
  }

  async function handleDownload(track: ScoredTrack) {
    if (downloadingId) return;
    setDownloadingId(track.trackId);
    try {
      // Fetch through our proxy which handles auth and CORS
      const res = await fetch(`/api/sc/tracks/${track.trackId}/stream`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || "Failed to download track");
        return;
      }

      const blob = await res.blob();
      // Get filename from Content-Disposition header, or fall back
      const disposition = res.headers.get("Content-Disposition");
      let filename = `${track.username} - ${track.title}.mp3`;
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  const widgetUrl = playingTrackId
    ? `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${playingTrackId}&color=%23f97316&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`
    : null;

  function SortArrow({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return (
      <span className="ml-1 text-orange-400">
        {sortDir === "asc" ? "\u25B2" : "\u25BC"}
      </span>
    );
  }

  function SortHeader({
    field,
    label,
    align = "left",
  }: {
    field: SortField;
    label: string;
    align?: "left" | "right";
  }) {
    return (
      <th
        className={`p-2 text-${align} text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors`}
        onClick={() => handleSort(field)}
      >
        {label}
        <SortArrow field={field} />
      </th>
    );
  }

  function WeightSlider({
    label,
    value,
    field,
  }: {
    label: string;
    value: number;
    field: keyof ScoringWeights;
  }) {
    return (
      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          {label}: {value}
        </label>
        <input
          type="range"
          min="0"
          max="500"
          value={value}
          onChange={(e) =>
            onWeightsChange({ ...weights, [field]: parseInt(e.target.value) })
          }
          className="w-full accent-orange-500"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          Preview Merged Tracks
        </h2>
        <div className="text-sm text-zinc-400">
          {tracks.length.toLocaleString()} total &rarr;{" "}
          {mergedTracks.length.toLocaleString()} after dedup
          {dedupCount > 0 && ` (${dedupCount} duplicates removed)`}
        </div>
      </div>

      {/* SoundCloud player */}
      {widgetUrl && (
        <div className="bg-zinc-900 rounded-lg overflow-hidden">
          <iframe
            ref={iframeRef}
            width="100%"
            height="80"
            scrolling="no"
            frameBorder="no"
            allow="autoplay"
            src={widgetUrl}
          />
        </div>
      )}

      {/* Scoring weights */}
      <div className="grid grid-cols-4 gap-4 bg-zinc-900 rounded-lg p-4">
        <WeightSlider label="Plays" value={weights.play} field="play" />
        <WeightSlider label="Likes" value={weights.like} field="like" />
        <WeightSlider label="Reposts" value={weights.repost} field="repost" />
        <WeightSlider
          label="Comments"
          value={weights.comment}
          field="comment"
        />
      </div>

      <div className="flex items-center gap-4 bg-zinc-900 rounded-lg p-4">
        <label className="text-sm text-zinc-400">Max tracks:</label>
        <input
          type="number"
          min="1"
          max="5000"
          value={maxTracks}
          onChange={(e) => onMaxTracksChange(parseInt(e.target.value) || 500)}
          className="w-24 bg-zinc-800 border border-zinc-700 rounded p-1 text-white text-sm focus:border-orange-500 focus:outline-none"
        />
      </div>

      {/* Track table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 sticky top-0">
            <tr>
              <th className="p-2 text-left text-zinc-400 w-12">#</th>
              <th className="p-2 text-left text-zinc-400 w-10"></th>
              <SortHeader field="title" label="Title" />
              <SortHeader field="username" label="Artist" />
              <SortHeader field="createdAt" label="Date" />
              <SortHeader field="playbackCount" label="Plays" align="right" />
              <SortHeader field="likesCount" label="Likes" align="right" />
              <SortHeader field="repostsCount" label="Reposts" align="right" />
              <SortHeader field="score" label="Score" align="right" />
              <th className="p-2 text-center text-zinc-400 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sortedTracks.map((t, i) => (
              <tr
                key={`${t.trackId}-${i}`}
                className={`border-t border-zinc-800 ${
                  playingTrackId === t.trackId ? "bg-zinc-800/50" : ""
                }`}
              >
                <td className="p-2 text-zinc-500">{i + 1}</td>
                <td className="p-2">
                  <button
                    onClick={() => handlePlay(t)}
                    className="text-zinc-400 hover:text-orange-400 transition-colors"
                    title={
                      playingTrackId === t.trackId ? "Stop" : "Play preview"
                    }
                  >
                    {playingTrackId === t.trackId ? (
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <rect x="6" y="4" width="4" height="16" />
                        <rect x="14" y="4" width="4" height="16" />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </td>
                <td className="p-2 max-w-xs truncate">
                  {t.permalinkUrl ? (
                    <a
                      href={t.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-orange-400 transition-colors"
                    >
                      {t.title}
                    </a>
                  ) : (
                    <span className="text-white">{t.title}</span>
                  )}
                </td>
                <td className="p-2 text-zinc-400 max-w-32 truncate">
                  {t.artistUrl ? (
                    <a
                      href={t.artistUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-orange-400 transition-colors"
                    >
                      {t.username}
                    </a>
                  ) : (
                    t.username
                  )}
                </td>
                <td className="p-2 text-zinc-500 whitespace-nowrap text-xs">
                  {formatDate(t.createdAt)}
                </td>
                <td className="p-2 text-right text-zinc-300">
                  {t.playbackCount.toLocaleString()}
                </td>
                <td className="p-2 text-right text-zinc-300">
                  {t.likesCount.toLocaleString()}
                </td>
                <td className="p-2 text-right text-zinc-300">
                  {t.repostsCount.toLocaleString()}
                </td>
                <td className="p-2 text-right text-orange-400 font-mono">
                  {t.score.toLocaleString()}
                </td>
                <td className="p-2 text-center">
                  <button
                    onClick={() => handleDownload(t)}
                    disabled={downloadingId !== null}
                    className="text-zinc-500 hover:text-orange-400 transition-colors disabled:opacity-30 cursor-pointer"
                    title="Download"
                  >
                    {downloadingId === t.trackId ? (
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
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"
                        />
                      </svg>
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => {
            onMergedTracksChange(sortedTracks);
            onNext();
          }}
          disabled={mergedTracks.length === 0}
          className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
        >
          Next: Create playlist ({mergedTracks.length.toLocaleString()} tracks)
        </button>
      </div>
    </div>
  );
}
