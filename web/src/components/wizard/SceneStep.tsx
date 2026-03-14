"use client";

import { useEffect, useState } from "react";
import type { SceneConfig, SceneEdge, SceneProgress, SceneUser } from "@/types";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tooltip } from "@/components/ui/Tooltip";
import { SceneGraph } from "./SceneGraph";

interface Props {
  config: SceneConfig;
  progress: SceneProgress;
  sceneUsers: SceneUser[];
  sceneEdges: SceneEdge[];
  trackCount: number;
  onConfigChange: (config: SceneConfig) => void;
  onDiscover: () => void;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
}

const PHASE_LABELS: Record<SceneProgress["phase"], string> = {
  idle: "",
  seeds: "Finding artists",
  graph: "Mapping scene connections",
  tracks: "Discovering tracks",
  done: "Discovery complete",
};

export function SceneStep({
  config,
  progress,
  sceneUsers,
  sceneEdges,
  trackCount,
  onConfigChange,
  onDiscover,
  onCancel,
  onBack,
  onNext,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Ctrl+Enter keyboard shortcut to discover
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const canDiscover = config.city.trim() || (config.seedsOnly && config.seedArtists.trim());
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !progress.isRunning && canDiscover) {
        e.preventDefault();
        onDiscover();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const phaseLabel = PHASE_LABELS[progress.phase];
  const phaseDetail =
    progress.phase === "seeds"
      ? `in ${config.city}... (${progress.seedsFound} seeds found)`
      : progress.phase === "graph"
        ? `(${progress.completed}/${progress.total} seeds crawled, ${progress.sceneMembersFound} scene members)`
        : progress.phase === "tracks"
          ? `(${progress.completed}/${progress.total} members, ${progress.tracksFound} tracks)`
          : progress.phase === "done"
            ? `${progress.sceneMembersFound} scene members, ${trackCount} tracks scored`
            : "";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Scene Discovery</h2>
      <p className="text-sm text-zinc-400">
        Find what&apos;s trending in a city&apos;s underground scene by mapping the local
        social graph and scoring tracks by{" "}
        <Tooltip content="Repost velocity measures how fast a track is being shared. It's calculated as reposts per day, weighted by how connected the track is to the local scene and boosted for recency (newer tracks score higher).">
          <span className="underline decoration-dotted cursor-help">
            repost velocity
          </span>
        </Tooltip>.
      </p>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">City</label>
        <input
          type="text"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white text-lg focus:border-orange-500 focus:outline-none"
          value={config.city}
          onChange={(e) => onConfigChange({ ...config, city: e.target.value })}
          placeholder="Bristol, Auckland, Berlin"
          disabled={progress.isRunning}
        />
        <p className="text-xs text-zinc-500 mt-1">
          Separate multiple cities with commas
        </p>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Genre / keywords (optional)</label>
        <input
          type="text"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white focus:border-orange-500 focus:outline-none"
          value={config.genreKeywords}
          onChange={(e) => onConfigChange({ ...config, genreKeywords: e.target.value })}
          placeholder="dnb, jungle, dubstep"
          disabled={progress.isRunning}
        />
        <div className="flex items-center gap-3 mt-2">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={config.filterTracksByGenre}
              onChange={(e) =>
                onConfigChange({ ...config, filterTracksByGenre: e.target.checked })
              }
              disabled={progress.isRunning || !config.genreKeywords.trim()}
              className="accent-orange-500"
            />
            Filter tracks by genre
          </label>
          <span className="text-xs text-zinc-600">
            {config.filterTracksByGenre
              ? "Keywords filter seed search + tracks"
              : "Keywords only bias seed search"}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Seed artists (optional)</label>
        <textarea
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white text-sm focus:border-orange-500 focus:outline-none resize-none"
          rows={2}
          value={config.seedArtists}
          onChange={(e) => onConfigChange({ ...config, seedArtists: e.target.value })}
          placeholder="kojiaikendnb, https://soundcloud.com/andyc_ram"
          disabled={progress.isRunning}
        />
        <p className="text-xs text-zinc-500 mt-1">
          SoundCloud usernames or URLs — always included as seeds regardless of city filter
        </p>
        {config.seedArtists.trim() && (
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer mt-2">
            <input
              type="checkbox"
              checked={config.seedsOnly}
              onChange={(e) =>
                onConfigChange({ ...config, seedsOnly: e.target.checked })
              }
              disabled={progress.isRunning}
              className="accent-orange-500"
            />
            Use only these seed artists (skip city search)
          </label>
        )}
      </div>

      {/* Advanced settings */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {showAdvanced ? "Hide" : "Show"} advanced settings
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-4 gap-4 bg-zinc-900 rounded-lg p-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Max seed artists
            </label>
            <input
              type="number"
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
              value={config.maxSeedUsers}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  maxSeedUsers: parseInt(e.target.value) || 50,
                })
              }
              disabled={progress.isRunning}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Min connections
            </label>
            <input
              type="number"
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
              value={config.minFollowedByCount}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  minFollowedByCount: parseInt(e.target.value) || 2,
                })
              }
              disabled={progress.isRunning}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Max scene members
            </label>
            <input
              type="number"
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
              value={config.maxSceneMembers}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  maxSceneMembers: parseInt(e.target.value) || 200,
                })
              }
              disabled={progress.isRunning}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Recency (days)
            </label>
            <input
              type="number"
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white text-sm focus:border-orange-500 focus:outline-none"
              value={config.recencyDays}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  recencyDays: parseInt(e.target.value) || 90,
                })
              }
              disabled={progress.isRunning}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          disabled={progress.isRunning}
          className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-white font-medium rounded-lg transition-colors"
        >
          Back
        </button>

        {!progress.isRunning ? (
          <button
            onClick={onDiscover}
            disabled={!config.city.trim() && !(config.seedsOnly && config.seedArtists.trim())}
            className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
          >
            Discover Scene
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}

        {trackCount > 0 && !progress.isRunning && (
          <button
            onClick={onNext}
            className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
          >
            Next: Preview ({trackCount.toLocaleString()} tracks)
          </button>
        )}
      </div>

      {/* Progress */}
      {(progress.isRunning || progress.phase === "done") && (
        <div className="space-y-3">
          {progress.isRunning && progress.total > 0 && (
            <ProgressBar
              completed={progress.completed}
              total={progress.total}
              label={`${phaseLabel} ${phaseDetail}`}
            />
          )}

          {!progress.isRunning && progress.phase === "done" && (
            <p className="text-sm text-green-400">{phaseLabel}: {phaseDetail}</p>
          )}

          {progress.isRunning && progress.total === 0 && (
            <p className="text-sm text-zinc-400 animate-pulse">
              {phaseLabel} {phaseDetail}
            </p>
          )}

          {/* Scene graph visualization */}
          {sceneUsers.length > 0 && (
            <div>
              <p className="text-sm text-zinc-400 mb-1">
                {progress.seedsFound} seeds + {progress.sceneMembersFound - progress.seedsFound} connected artists
              </p>
              <SceneGraph
                nodes={sceneUsers}
                edges={sceneEdges}
                phase={progress.phase}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
