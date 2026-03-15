"use client";

import { useEffect, useMemo, useState } from "react";
import type { MyPlaylist, MergeProgress } from "@/types";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  playlists: MyPlaylist[];
  progress: MergeProgress;
  trackCount: number;
  onLoadPlaylists: () => void;
  onToggle: (id: number) => void;
  onSelectAll: (selected: boolean) => void;
  onAddPlaylist: (playlist: MyPlaylist) => void;
  onFetchTracks: () => void;
  onCancel: () => void;
  onNext: () => void;
  canAddExternal?: boolean;
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

export function MergeStep({
  playlists,
  progress,
  trackCount,
  onLoadPlaylists,
  onToggle,
  onSelectAll,
  onAddPlaylist,
  onFetchTracks,
  onCancel,
  onNext,
  canAddExternal = false,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  // Load playlists on mount
  useEffect(() => {
    if (!loaded && playlists.length === 0) {
      setLoaded(true);
      onLoadPlaylists();
    }
  }, [loaded, playlists.length, onLoadPlaylists]);

  const filteredPlaylists = useMemo(() => {
    if (!filter.trim()) return playlists;
    const q = filter.toLowerCase();
    return playlists.filter((p) => p.title.toLowerCase().includes(q));
  }, [playlists, filter]);

  const selectedCount = playlists.filter((p) => p.selected).length;
  const allFilteredSelected =
    filteredPlaylists.length > 0 &&
    filteredPlaylists.every((p) => p.selected);
  const totalSelectedTracks = playlists
    .filter((p) => p.selected)
    .reduce((sum, p) => sum + p.trackCount, 0);

  const isLoading = progress.phase === "loading" && progress.isRunning;
  const isFetching = progress.phase === "fetching" && progress.isRunning;
  const isDone = progress.phase === "done" && trackCount > 0;

  async function handleAddExternal() {
    const trimmed = externalUrl.trim();
    if (!trimmed) return;

    // Validate it looks like a SoundCloud URL
    try {
      const parsed = new URL(trimmed);
      if (
        !parsed.hostname.includes("soundcloud.com")
      ) {
        setResolveError("Please enter a SoundCloud playlist URL");
        return;
      }
    } catch {
      setResolveError("Please enter a valid URL");
      return;
    }

    setResolving(true);
    setResolveError("");

    try {
      const res = await fetch("/api/sc/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!res.ok) {
        setResolveError("Could not find that playlist");
        return;
      }

      const data = await res.json();

      if (data.kind !== "playlist") {
        setResolveError(
          data.kind === "track"
            ? "That's a track, not a playlist. Use the Download Track tab for single tracks."
            : data.kind === "user"
              ? "That's a user profile, not a playlist."
              : "URL does not point to a playlist."
        );
        return;
      }

      const pl = data.resolved;

      // Check if already in the list
      if (playlists.some((p) => p.id === pl.id)) {
        setResolveError("This playlist is already in your list");
        return;
      }

      onAddPlaylist({
        id: pl.id,
        title: pl.title || "Untitled",
        trackCount: pl.track_count || 0,
        likesCount: pl.likes_count || 0,
        sharing: pl.sharing || "public",
        createdAt: pl.created_at || new Date().toISOString(),
        permalinkUrl: pl.permalink_url || trimmed,
        selected: true,
        isExternal: true,
      });

      setExternalUrl("");
    } catch {
      setResolveError("Failed to resolve playlist");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          Merge Your Playlists
        </h2>
        {playlists.length > 0 && (
          <span className="text-sm text-zinc-400">
            {playlists.length} playlist
            {playlists.length !== 1 ? "s" : ""} found
          </span>
        )}
      </div>

      <p className="text-sm text-zinc-400">
        Select playlists from your SoundCloud library to merge together. Tracks
        will be deduplicated, scored, and sorted.
      </p>

      {/* Add external playlist — or upgrade prompt */}
      {!canAddExternal && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Want to merge playlists from other users?
          </p>
          <a
            href="/dashboard/pricing"
            className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-orange-400 rounded-lg transition-colors whitespace-nowrap"
          >
            Upgrade to Pro
          </a>
        </div>
      )}
      {canAddExternal && (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => {
                setExternalUrl(e.target.value);
                if (resolveError) setResolveError("");
              }}
              placeholder="Paste a SoundCloud playlist URL to add..."
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
              disabled={resolving}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !resolving) handleAddExternal();
              }}
            />
            <button
              onClick={handleAddExternal}
              disabled={!externalUrl.trim() || resolving}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {resolving ? "Adding..." : "Add playlist"}
            </button>
          </div>
          {resolveError && (
            <p className="text-xs text-red-400">{resolveError}</p>
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-3 py-8 justify-center">
          <Spinner />
          <span className="text-sm text-zinc-400">
            Loading your playlists...
          </span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && loaded && playlists.length === 0 && (
        <EmptyState
          icon="playlist"
          title="No playlists found"
          description="You don't have any playlists on SoundCloud yet."
        />
      )}

      {/* Playlist table */}
      {playlists.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => onSelectAll(!allFilteredSelected)}
                className="accent-orange-500"
              />
              Select all
            </label>
            {selectedCount > 0 && (
              <span className="text-sm text-zinc-500">
                {selectedCount} selected (
                {totalSelectedTracks.toLocaleString()} tracks)
              </span>
            )}
            <div className="ml-auto">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter playlists..."
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none w-48"
              />
            </div>
          </div>

          <div className="border border-zinc-800 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left text-zinc-400 w-10"></th>
                  <th className="p-2 text-left text-zinc-400">Title</th>
                  <th className="p-2 text-right text-zinc-400">Tracks</th>
                  <th className="p-2 text-right text-zinc-400">Likes</th>
                  <th className="p-2 text-left text-zinc-400">Sharing</th>
                  <th className="p-2 text-left text-zinc-400">Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlaylists.map((pl) => (
                  <tr
                    key={pl.id}
                    className={`border-t border-zinc-800 cursor-pointer transition-colors ${
                      pl.selected
                        ? "bg-zinc-800/50"
                        : "hover:bg-zinc-900/50"
                    }`}
                    onClick={() => onToggle(pl.id)}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={pl.selected}
                        onChange={() => onToggle(pl.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-orange-500"
                      />
                    </td>
                    <td className="p-2 text-white max-w-xs truncate">
                      <span className="flex items-center gap-2">
                        {pl.permalinkUrl ? (
                          <a
                            href={pl.permalinkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-orange-400 transition-colors truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {pl.title}
                          </a>
                        ) : (
                          <span className="truncate">{pl.title}</span>
                        )}
                        {pl.isExternal && (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                            external
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-2 text-right text-zinc-300 font-mono">
                      {pl.trackCount.toLocaleString()}
                    </td>
                    <td className="p-2 text-right text-zinc-300 font-mono">
                      {pl.likesCount.toLocaleString()}
                    </td>
                    <td className="p-2 text-zinc-400 capitalize">
                      {pl.sharing}
                    </td>
                    <td className="p-2 text-zinc-500 whitespace-nowrap text-xs">
                      {formatDate(pl.createdAt)}
                    </td>
                  </tr>
                ))}
                {filteredPlaylists.length === 0 && filter && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-6 text-center text-zinc-500 text-sm"
                    >
                      No playlists match &quot;{filter}&quot;
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Fetch progress */}
      {isFetching && (
        <ProgressBar
          completed={progress.completed}
          total={progress.total}
          label={`Fetching: ${progress.currentPlaylist}`}
        />
      )}

      {/* Done state */}
      {isDone && (
        <div className="text-sm text-green-400">
          Fetched {trackCount.toLocaleString()} tracks from {selectedCount}{" "}
          playlist{selectedCount !== 1 ? "s" : ""}.
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4">
        {!isDone ? (
          <>
            {isFetching ? (
              <button
                onClick={onCancel}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={onFetchTracks}
                disabled={selectedCount === 0 || isLoading}
                className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
              >
                Fetch tracks ({selectedCount} playlist
                {selectedCount !== 1 ? "s" : ""})
              </button>
            )}
          </>
        ) : (
          <button
            onClick={onNext}
            className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Next: Preview ({trackCount.toLocaleString()} tracks)
          </button>
        )}
      </div>
    </div>
  );
}
