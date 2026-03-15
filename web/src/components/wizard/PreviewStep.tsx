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
  isAdmin?: boolean;
  canRemoveTracks?: boolean;
  canCustomizeColumns?: boolean;
}

type SortField = string;
type SortDir = "asc" | "desc";

const MAX_OPTIONAL_COLUMNS = 8;

// --- Column definitions ---
interface ColumnDef {
  key: string;
  label: string;
  align: "left" | "right";
  sortable: boolean;
  defaultOn: boolean; // shown by default
  sortType: "string" | "number" | "date";
  getValue: (t: ScoredTrack) => string | number;
  render: (t: ScoredTrack) => React.ReactNode;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const OPTIONAL_COLUMNS: ColumnDef[] = [
  {
    key: "duration",
    label: "Time",
    align: "right",
    sortable: true,
    defaultOn: true,
    sortType: "number",
    getValue: (t) => t.duration,
    render: (t) => (
      <span className="font-mono text-xs">{formatDuration(t.duration)}</span>
    ),
  },
  {
    key: "createdAt",
    label: "Date",
    align: "left",
    sortable: true,
    defaultOn: true,
    sortType: "date",
    getValue: (t) => t.createdAt,
    render: (t) => (
      <span className="whitespace-nowrap text-xs">{formatDate(t.createdAt)}</span>
    ),
  },
  {
    key: "playbackCount",
    label: "Plays",
    align: "right",
    sortable: true,
    defaultOn: true,
    sortType: "number",
    getValue: (t) => t.playbackCount,
    render: (t) => t.playbackCount.toLocaleString(),
  },
  {
    key: "likesCount",
    label: "Likes",
    align: "right",
    sortable: true,
    defaultOn: true,
    sortType: "number",
    getValue: (t) => t.likesCount,
    render: (t) => t.likesCount.toLocaleString(),
  },
  {
    key: "repostsCount",
    label: "Reposts",
    align: "right",
    sortable: true,
    defaultOn: true,
    sortType: "number",
    getValue: (t) => t.repostsCount,
    render: (t) => t.repostsCount.toLocaleString(),
  },
  {
    key: "genre",
    label: "Genre",
    align: "left",
    sortable: true,
    defaultOn: false,
    sortType: "string",
    getValue: (t) => t.genre,
    render: (t) => (
      <span className="max-w-24 truncate inline-block">{t.genre || "—"}</span>
    ),
  },
  {
    key: "bpm",
    label: "BPM",
    align: "right",
    sortable: true,
    defaultOn: false,
    sortType: "number",
    getValue: (t) => t.bpm ?? 0,
    render: (t) => (
      <span className="font-mono">{t.bpm ? Math.round(t.bpm) : "—"}</span>
    ),
  },
  {
    key: "keySignature",
    label: "Key",
    align: "left",
    sortable: true,
    defaultOn: false,
    sortType: "string",
    getValue: (t) => t.keySignature ?? "",
    render: (t) => t.keySignature || "—",
  },
  {
    key: "labelName",
    label: "Label",
    align: "left",
    sortable: true,
    defaultOn: false,
    sortType: "string",
    getValue: (t) => t.labelName ?? "",
    render: (t) => (
      <span className="max-w-24 truncate inline-block">
        {t.labelName || "—"}
      </span>
    ),
  },
  {
    key: "commentCount",
    label: "Comments",
    align: "right",
    sortable: true,
    defaultOn: false,
    sortType: "number",
    getValue: (t) => t.commentCount,
    render: (t) => t.commentCount.toLocaleString(),
  },
  {
    key: "downloadCount",
    label: "Downloads",
    align: "right",
    sortable: true,
    defaultOn: false,
    sortType: "number",
    getValue: (t) => t.downloadCount,
    render: (t) => t.downloadCount.toLocaleString(),
  },
  {
    key: "tagList",
    label: "Tags",
    align: "left",
    sortable: false,
    defaultOn: false,
    sortType: "string",
    getValue: (t) => t.tagList,
    render: (t) => (
      <span className="max-w-32 truncate inline-block text-xs">
        {t.tagList || "—"}
      </span>
    ),
  },
  {
    key: "sourcePlaylistTitle",
    label: "Source",
    align: "left",
    sortable: true,
    defaultOn: false,
    sortType: "string",
    getValue: (t) => t.sourcePlaylistTitle,
    render: (t) => (
      <span className="max-w-24 truncate inline-block text-xs">
        {t.sourcePlaylistTitle}
      </span>
    ),
  },
];

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
  isAdmin = false,
  canRemoveTracks = false,
  canCustomizeColumns = false,
}: Props) {
  const [playingTrackId, setPlayingTrackId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [minDuration, setMinDuration] = useState(30);
  const [maxDuration, setMaxDuration] = useState(600);
  const [enabledColumns, setEnabledColumns] = useState<Set<string>>(
    () => new Set(OPTIONAL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key))
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Close column picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        columnPickerRef.current &&
        !columnPickerRef.current.contains(e.target as Node)
      ) {
        setShowColumnPicker(false);
      }
    }
    if (showColumnPicker) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColumnPicker]);

  // Recompute merged tracks when weights, maxTracks, or duration filter change
  useEffect(() => {
    const result = mergeTracks(tracks, weights, maxTracks, {
      minSec: minDuration,
      maxSec: maxDuration,
    });
    onMergedTracksChange(result);
  }, [tracks, weights, maxTracks, minDuration, maxDuration, onMergedTracksChange]);

  const activeColumns = useMemo(
    () => OPTIONAL_COLUMNS.filter((c) => enabledColumns.has(c.key)),
    [enabledColumns]
  );

  const sortedTracks = useMemo(() => {
    const col = OPTIONAL_COLUMNS.find((c) => c.key === sortField);
    const sorted = [...mergedTracks].sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortField === "username") {
        cmp = a.username.localeCompare(b.username);
      } else if (sortField === "score") {
        cmp = a.score - b.score;
      } else if (col) {
        const va = col.getValue(a);
        const vb = col.getValue(b);
        if (col.sortType === "string") {
          cmp = String(va).localeCompare(String(vb));
        } else if (col.sortType === "date") {
          cmp = new Date(va as string).getTime() - new Date(vb as string).getTime();
        } else {
          cmp = (va as number) - (vb as number);
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [mergedTracks, sortField, sortDir]);

  const dedupCount = tracks.length - mergedTracks.length;

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      const col = OPTIONAL_COLUMNS.find((c) => c.key === field);
      setSortDir(
        field === "title" || field === "username" || col?.sortType === "string"
          ? "asc"
          : "desc"
      );
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
      const res = await fetch(`/api/sc/tracks/${track.trackId}/stream`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || "Failed to download track");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = `${track.username} - ${track.title}.mp3`;
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/);
        if (utf8Match) {
          filename = decodeURIComponent(utf8Match[1]);
        } else {
          const match = disposition.match(/filename="(.+?)"/);
          if (match) filename = match[1];
        }
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

  function handleRemoveTrack(trackId: number) {
    onMergedTracksChange(mergedTracks.filter((t) => t.trackId !== trackId));
  }

  function toggleColumn(key: string) {
    setEnabledColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_OPTIONAL_COLUMNS) {
        next.add(key);
      }
      return next;
    });
  }

  const widgetUrl = playingTrackId
    ? `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${playingTrackId}&color=%23f97316&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`
    : null;

  function SortArrow({ field }: { field: string }) {
    if (sortField !== field) return null;
    return (
      <span className="ml-1 text-orange-400">
        {sortDir === "asc" ? "\u25B2" : "\u25BC"}
      </span>
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
        <div className="flex items-center gap-4">
          <div className="text-sm text-zinc-400">
            {tracks.length.toLocaleString()} total &rarr;{" "}
            {mergedTracks.length.toLocaleString()} after dedup
            {dedupCount > 0 && ` (${dedupCount} duplicates removed)`}
          </div>

          {/* Column picker or upgrade nudge */}
          {!canCustomizeColumns && (
            <a
              href="/dashboard/pricing"
              className="flex items-center gap-1 text-xs text-zinc-600 hover:text-orange-400 transition-colors"
              title="Add Genre, BPM, Key, Label columns"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75M10.5 18a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 18H7.5m3-6h9.75M10.5 12a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 12H7.5" />
              </svg>
              More columns with Pro
            </a>
          )}
          {canCustomizeColumns && (
            <div ref={columnPickerRef} className="relative">
              <button
                onClick={() => setShowColumnPicker(!showColumnPicker)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-orange-400 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75M10.5 18a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 18H7.5m3-6h9.75M10.5 12a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 12H7.5" />
                </svg>
                Columns ({enabledColumns.size}/{MAX_OPTIONAL_COLUMNS})
              </button>
              {showColumnPicker && (
                <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
                  {OPTIONAL_COLUMNS.map((col) => {
                    const enabled = enabledColumns.has(col.key);
                    const atLimit =
                      !enabled && enabledColumns.size >= MAX_OPTIONAL_COLUMNS;
                    return (
                      <button
                        key={col.key}
                        onClick={() => toggleColumn(col.key)}
                        disabled={atLimit}
                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                          enabled
                            ? "text-white"
                            : atLimit
                              ? "text-zinc-600 cursor-not-allowed"
                              : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                            enabled
                              ? "bg-orange-500 border-orange-500"
                              : "border-zinc-600"
                          }`}
                        >
                          {enabled && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-zinc-900 rounded-lg p-4">
        <WeightSlider label="Plays" value={weights.play} field="play" />
        <WeightSlider label="Likes" value={weights.like} field="like" />
        <WeightSlider label="Reposts" value={weights.repost} field="repost" />
        <WeightSlider
          label="Comments"
          value={weights.comment}
          field="comment"
        />
      </div>

      <div className="flex items-center gap-4 flex-wrap bg-zinc-900 rounded-lg p-4">
        <label className="text-sm text-zinc-400">Max tracks:</label>
        <input
          type="number"
          min="1"
          max="5000"
          value={maxTracks}
          onChange={(e) => onMaxTracksChange(parseInt(e.target.value) || 500)}
          className="w-24 bg-zinc-800 border border-zinc-700 rounded p-1 text-white text-sm focus:border-orange-500 focus:outline-none"
        />
        <span className="text-zinc-700">|</span>
        <label className="text-sm text-zinc-400">Duration:</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="3600"
            value={minDuration}
            onChange={(e) =>
              setMinDuration(Math.max(0, parseInt(e.target.value) || 0))
            }
            className="w-16 bg-zinc-800 border border-zinc-700 rounded p-1 text-white text-sm focus:border-orange-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">to</span>
          <input
            type="number"
            min="1"
            max="7200"
            value={maxDuration}
            onChange={(e) =>
              setMaxDuration(Math.max(1, parseInt(e.target.value) || 600))
            }
            className="w-16 bg-zinc-800 border border-zinc-700 rounded p-1 text-white text-sm focus:border-orange-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">sec</span>
        </div>
        {!canCustomizeColumns && tracks.length > maxTracks && (
          <>
            <span className="text-zinc-700">|</span>
            <a href="/dashboard/pricing" className="text-xs text-zinc-600 hover:text-orange-400 transition-colors">
              Showing {maxTracks} of {tracks.length.toLocaleString()} — upgrade for more
            </a>
          </>
        )}
      </div>

      {/* Track table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden max-h-96 overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 sticky top-0 z-10">
            <tr>
              <th className="p-2 text-left text-zinc-400 w-12">#</th>
              <th className="p-2 text-left text-zinc-400 w-10"></th>
              <th
                className="p-2 text-left text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors"
                onClick={() => handleSort("title")}
              >
                Title
                <SortArrow field="title" />
              </th>
              <th
                className="p-2 text-left text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors"
                onClick={() => handleSort("username")}
              >
                Artist
                <SortArrow field="username" />
              </th>
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  className={`p-2 ${col.align === "right" ? "text-right" : "text-left"} text-zinc-400 ${
                    col.sortable
                      ? "cursor-pointer select-none hover:text-zinc-200 transition-colors"
                      : ""
                  }`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.label}
                  {col.sortable && <SortArrow field={col.key} />}
                </th>
              ))}
              <th
                className="p-2 text-right text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors"
                onClick={() => handleSort("score")}
              >
                Score
                <SortArrow field="score" />
              </th>
              {isAdmin && (
                <th className="p-2 text-center text-zinc-400 w-10"></th>
              )}
              {(canRemoveTracks || !canCustomizeColumns) && (
                <th className="p-2 text-center text-zinc-400 w-10"></th>
              )}
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
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="4" width="4" height="16" />
                        <rect x="14" y="4" width="4" height="16" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
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
                {activeColumns.map((col) => (
                  <td
                    key={col.key}
                    className={`p-2 ${col.align === "right" ? "text-right" : "text-left"} text-zinc-${col.key === "duration" ? "500" : "300"}`}
                  >
                    {col.render(t)}
                  </td>
                ))}
                <td className="p-2 text-right text-orange-400 font-mono">
                  {t.score.toLocaleString()}
                </td>
                {isAdmin && (
                  <td className="p-2 text-center">
                    <button
                      onClick={() => handleDownload(t)}
                      disabled={downloadingId !== null}
                      className="text-zinc-500 hover:text-orange-400 transition-colors disabled:opacity-30 cursor-pointer"
                      title="Download"
                    >
                      {downloadingId === t.trackId ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
                        </svg>
                      )}
                    </button>
                  </td>
                )}
                {canRemoveTracks ? (
                  <td className="p-2 text-center">
                    <button
                      onClick={() => handleRemoveTrack(t.trackId)}
                      className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer"
                      title="Remove track"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                ) : !canCustomizeColumns && (
                  <td className="p-2 text-center">
                    <span
                      className="text-zinc-800 cursor-default"
                      title="Remove tracks with Pro — Upgrade at Settings > Pricing"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors cursor-pointer"
        >
          Back
        </button>
        <button
          onClick={() => {
            onMergedTracksChange(sortedTracks);
            onNext();
          }}
          disabled={mergedTracks.length === 0}
          className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
        >
          Next: Create playlist ({mergedTracks.length.toLocaleString()} tracks)
        </button>
      </div>
    </div>
  );
}
