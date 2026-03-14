"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchConfig, WizardState } from "@/types";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SavedSearches } from "@/components/ui/SavedSearches";

interface Props {
  config: SearchConfig;
  progress: WizardState["searchProgress"];
  playlistCount: number;
  onConfigChange: (config: SearchConfig) => void;
  onSearch: (config: SearchConfig) => void;
  onCancel: () => void;
  onNext: () => void;
}

export function SearchStep({
  config,
  progress,
  playlistCount,
  onConfigChange,
  onSearch,
  onCancel,
  onNext,
}: Props) {
  const [queriesText, setQueriesText] = useState(config.queries.join("\n"));
  const [requireTermsText, setRequireTermsText] = useState(
    config.requireTerms.join(", ")
  );
  const [excludeTermsText, setExcludeTermsText] = useState(
    config.excludeTerms.join(", ")
  );

  // Auto-scroll the feed to the bottom
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [progress.foundNames]);

  // Ctrl+Enter keyboard shortcut to search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !progress.isRunning) {
        e.preventDefault();
        handleSearch();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  function handleSearch() {
    const queries = queriesText
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);
    const requireTerms = requireTermsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const excludeTerms = excludeTermsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const newConfig = { ...config, queries, requireTerms, excludeTerms };
    onConfigChange(newConfig);
    onSearch(newConfig);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Search Playlists</h2>

      <SavedSearches
        type="playlist_search"
        currentConfig={config as unknown as Record<string, unknown>}
        onLoad={(cfg) => {
          const loaded = cfg as unknown as SearchConfig;
          onConfigChange(loaded);
          setQueriesText(loaded.queries?.join("\n") || "");
          setRequireTermsText(loaded.requireTerms?.join(", ") || "");
          setExcludeTermsText(loaded.excludeTerms?.join(", ") || "");
        }}
      />

      <div>
        <label className="block text-sm text-zinc-400 mb-1">
          Search queries (one per line)
        </label>
        <textarea
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white font-mono text-sm h-32 focus:border-orange-500 focus:outline-none"
          value={queriesText}
          onChange={(e) => setQueriesText(e.target.value)}
          placeholder={"dnb\ndnb bootleg\ndrum and bass"}
          disabled={progress.isRunning}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            Require terms (comma separated)
          </label>
          <input
            type="text"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={requireTermsText}
            onChange={(e) => setRequireTermsText(e.target.value)}
            placeholder="remix, bootleg"
            disabled={progress.isRunning}
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            Exclude terms (comma separated)
          </label>
          <input
            type="text"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={excludeTermsText}
            onChange={(e) => setExcludeTermsText(e.target.value)}
            placeholder="podcast, lecture"
            disabled={progress.isRunning}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Min tracks</label>
          <input
            type="number"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={config.minTrackCount}
            onChange={(e) =>
              onConfigChange({
                ...config,
                minTrackCount: parseInt(e.target.value) || 0,
              })
            }
            disabled={progress.isRunning}
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Max tracks</label>
          <input
            type="number"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={config.maxTrackCount}
            onChange={(e) =>
              onConfigChange({
                ...config,
                maxTrackCount: parseInt(e.target.value) || 500,
              })
            }
            disabled={progress.isRunning}
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Min likes</label>
          <input
            type="number"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={config.minLikes}
            onChange={(e) =>
              onConfigChange({
                ...config,
                minLikes: parseInt(e.target.value) || 0,
              })
            }
            disabled={progress.isRunning}
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Rank by</label>
          <select
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
            value={config.rankMode}
            onChange={(e) =>
              onConfigChange({
                ...config,
                rankMode: e.target.value as SearchConfig["rankMode"],
              })
            }
            disabled={progress.isRunning}
          >
            <option value="likes_per_track">Likes per track</option>
            <option value="likes">Total likes</option>
            <option value="recency_likes">Recency-weighted likes</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {!progress.isRunning ? (
          <button
            onClick={handleSearch}
            className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg transition-colors"
          >
            Search
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}

        {playlistCount > 0 && !progress.isRunning && (
          <button
            onClick={onNext}
            className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
          >
            Next: Select playlists ({playlistCount} found)
          </button>
        )}
      </div>

      {/* Progress bar + live feed */}
      {(progress.isRunning || progress.foundNames.length > 0) && (
        <div className="space-y-3">
          {progress.isRunning && (
            <ProgressBar
              completed={progress.completed}
              total={progress.total}
              label={`Searching: ${progress.currentQuery}`}
            />
          )}

          {progress.foundNames.length > 0 && (
            <div>
              <p className="text-sm text-zinc-400 mb-1">
                {progress.foundNames.length} playlists discovered
                {!progress.isRunning && playlistCount < progress.foundNames.length
                  ? ` (${playlistCount} after filtering)`
                  : ""}
              </p>
              <div
                ref={feedRef}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5"
              >
                {progress.foundNames.map((name, i) => (
                  <div key={i} className="text-zinc-400">
                    <span className="text-zinc-600 mr-2">{i + 1}.</span>
                    <span className="text-zinc-300">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
