"use client";

import { useCallback, useRef } from "react";
import type { SCPlaylist } from "@/lib/soundcloud/types";
import type { SCTrackRaw } from "@/lib/soundcloud/types";
import type { MyPlaylist, MergeProgress, ScoredTrack, ScoringWeights } from "@/types";
import { trackToScored } from "@/lib/soundcloud/scoring";

interface MergeActions {
  setMyPlaylists: (playlists: MyPlaylist[]) => void;
  setMergeProgress: (progress: Partial<MergeProgress>) => void;
  setTracks: (tracks: ScoredTrack[]) => void;
  addTracks: (tracks: ScoredTrack[]) => void;
}

export function useSCMyPlaylists(actions: MergeActions) {
  const abortRef = useRef(false);

  /** Load the user's playlists from SoundCloud */
  const loadPlaylists = useCallback(async () => {
    abortRef.current = false;
    actions.setMergeProgress({
      phase: "loading",
      completed: 0,
      total: 0,
      currentPlaylist: "",
      isRunning: true,
    });

    const all: MyPlaylist[] = [];
    let cursor: string | null = null;

    while (true) {
      if (abortRef.current) break;

      const fetchUrl: string = cursor
        ? `/api/sc/me/playlists?cursor=${encodeURIComponent(cursor)}`
        : "/api/sc/me/playlists";

      const res: Response = await fetch(fetchUrl);
      if (!res.ok) break;

      const data: { playlists: SCPlaylist[]; nextCursor: string | null } =
        await res.json();
      const playlists: SCPlaylist[] = data.playlists || [];

      for (const pl of playlists) {
        all.push({
          id: pl.id,
          title: pl.title,
          trackCount: pl.track_count,
          likesCount: pl.likes_count,
          sharing: pl.sharing,
          createdAt: pl.created_at,
          permalinkUrl: pl.permalink_url,
          selected: false,
        });
      }

      actions.setMyPlaylists(all);

      cursor = data.nextCursor;
      if (!cursor) break;
    }

    actions.setMergeProgress({
      phase: "idle",
      isRunning: false,
    });
  }, [actions]);

  /** Fetch tracks from selected playlists */
  const fetchSelectedTracks = useCallback(
    async (playlists: MyPlaylist[], weights: ScoringWeights) => {
      abortRef.current = false;
      const selected = playlists.filter((p) => p.selected);

      actions.setTracks([]);
      actions.setMergeProgress({
        phase: "fetching",
        completed: 0,
        total: selected.length,
        currentPlaylist: "",
        isRunning: true,
      });

      for (let i = 0; i < selected.length; i++) {
        if (abortRef.current) break;

        const pl = selected[i];
        actions.setMergeProgress({
          completed: i,
          currentPlaylist: pl.title,
        });

        const resp = await fetch(`/api/sc/playlists/${pl.id}/tracks`);
        if (!resp.ok) continue;

        const data = await resp.json();
        const rawTracks: SCTrackRaw[] = data.tracks || [];

        const scored = rawTracks.map((t) =>
          trackToScored(t, pl.id, pl.title, weights)
        );

        actions.addTracks(scored);
      }

      actions.setMergeProgress({
        phase: "done",
        completed: selected.length,
        isRunning: false,
      });
    },
    [actions]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { loadPlaylists, fetchSelectedTracks, abort };
}
