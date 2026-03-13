"use client";

import { useCallback, useRef } from "react";
import type { SCTrackRaw } from "@/lib/soundcloud/types";
import type { PlaylistCandidate, ScoredTrack, ScoringWeights } from "@/types";
import { trackToScored } from "@/lib/soundcloud/scoring";

interface TrackFetchActions {
  setTracks: (tracks: ScoredTrack[]) => void;
  addTracks: (tracks: ScoredTrack[]) => void;
  setProgress: (progress: {
    completed?: number;
    total?: number;
    currentPlaylist?: string;
    isRunning?: boolean;
  }) => void;
}

export function useSCTrackFetch(actions: TrackFetchActions) {
  const abortRef = useRef(false);

  const fetchTracks = useCallback(
    async (playlists: PlaylistCandidate[], weights: ScoringWeights) => {
      abortRef.current = false;
      actions.setTracks([]);
      actions.setProgress({
        completed: 0,
        total: playlists.length,
        currentPlaylist: "",
        isRunning: true,
      });

      for (let i = 0; i < playlists.length; i++) {
        if (abortRef.current) break;

        const pl = playlists[i];
        actions.setProgress({ completed: i, currentPlaylist: pl.title });

        const resp = await fetch(`/api/sc/playlists/${pl.id}/tracks`);
        if (!resp.ok) continue;

        const data = await resp.json();
        const rawTracks: SCTrackRaw[] = data.tracks || [];

        const scored = rawTracks.map((t) =>
          trackToScored(t, pl.id, pl.title, weights)
        );

        actions.addTracks(scored);
      }

      actions.setProgress({
        completed: playlists.length,
        isRunning: false,
      });
    },
    [actions]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { fetchTracks, abort };
}
