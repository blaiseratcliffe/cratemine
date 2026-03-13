"use client";

import type { PlaylistCandidate, WizardState } from "@/types";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface Props {
  playlists: PlaylistCandidate[];
  trackFetchProgress: WizardState["trackFetchProgress"];
  onToggle: (id: number) => void;
  onSelectAll: (selected: boolean) => void;
  onFetchTracks: () => void;
  onBack: () => void;
  onNext: () => void;
  trackCount: number;
}

export function SelectStep({
  playlists,
  trackFetchProgress,
  onToggle,
  onSelectAll,
  onFetchTracks,
  onBack,
  onNext,
  trackCount,
}: Props) {
  const selectedCount = playlists.filter((p) => p.selected).length;
  const allSelected = playlists.length > 0 && selectedCount === playlists.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          Select Source Playlists
        </h2>
        <span className="text-sm text-zinc-400">
          {selectedCount} of {playlists.length} selected
        </span>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900">
            <tr>
              <th className="p-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  className="accent-orange-500"
                />
              </th>
              <th className="p-2 text-left text-zinc-400">Title</th>
              <th className="p-2 text-left text-zinc-400">User</th>
              <th className="p-2 text-right text-zinc-400">Tracks</th>
              <th className="p-2 text-right text-zinc-400">Likes</th>
              <th className="p-2 text-right text-zinc-400">Likes/Track</th>
            </tr>
          </thead>
          <tbody>
            {playlists.map((pl) => (
              <tr
                key={pl.id}
                className="border-t border-zinc-800 hover:bg-zinc-900/50 cursor-pointer"
                onClick={() => onToggle(pl.id)}
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={pl.selected}
                    onChange={() => onToggle(pl.id)}
                    className="accent-orange-500"
                  />
                </td>
                <td className="p-2 text-white max-w-xs truncate">{pl.title}</td>
                <td className="p-2 text-zinc-400">{pl.user}</td>
                <td className="p-2 text-right text-zinc-300">
                  {pl.trackCount.toLocaleString()}
                </td>
                <td className="p-2 text-right text-zinc-300">
                  {pl.likesCount.toLocaleString()}
                </td>
                <td className="p-2 text-right text-zinc-300">
                  {pl.likesPerTrack.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trackFetchProgress.isRunning && (
        <ProgressBar
          completed={trackFetchProgress.completed}
          total={trackFetchProgress.total}
          label={`Fetching: ${trackFetchProgress.currentPlaylist}`}
        />
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={onFetchTracks}
          disabled={selectedCount === 0 || trackFetchProgress.isRunning}
          className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors"
        >
          {trackFetchProgress.isRunning
            ? "Fetching tracks..."
            : `Fetch tracks from ${selectedCount} playlists`}
        </button>
        {trackCount > 0 && !trackFetchProgress.isRunning && (
          <button
            onClick={onNext}
            className="px-6 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
          >
            Next: Preview ({trackCount.toLocaleString()} tracks)
          </button>
        )}
      </div>
    </div>
  );
}
