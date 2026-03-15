"use client";

import { useCallback, useRef } from "react";
import type { SCPlaylist } from "@/lib/soundcloud/types";
import type { SearchConfig, PlaylistCandidate } from "@/types";
import {
  filterPlaylists,
  rankPlaylists,
  toCandidate,
} from "@/lib/soundcloud/search";

interface SearchActions {
  setPlaylists: (playlists: PlaylistCandidate[]) => void;
  addPlaylists: (playlists: PlaylistCandidate[]) => void;
  setProgress: (progress: {
    completed?: number;
    total?: number;
    currentQuery?: string;
    isRunning?: boolean;
    foundNames?: string[];
  }) => void;
}

export function useSCSearch(actions: SearchActions) {
  const abortRef = useRef(false);

  const search = useCallback(
    async (config: SearchConfig) => {
      // Check daily usage limit
      try {
        const usageRes = await fetch("/api/usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "playlist_search" }),
        });
        if (usageRes.ok) {
          const usage = await usageRes.json();
          if (!usage.allowed) {
            alert(usage.message || "Daily search limit reached. Upgrade for more.");
            return;
          }
        }
      } catch {
        // If usage check fails, allow the search to proceed
      }

      abortRef.current = false;
      actions.setPlaylists([]);
      actions.setProgress({
        completed: 0,
        total: config.queries.length,
        currentQuery: "",
        isRunning: true,
        foundNames: [],
      });

      const allRaw: SCPlaylist[] = [];
      const seenIds = new Set<number>();
      const foundNames: string[] = [];

      for (let i = 0; i < config.queries.length; i++) {
        if (abortRef.current) break;

        const query = config.queries[i];
        actions.setProgress({ completed: i, currentQuery: query });

        let cursor: string | null = null;

        // Paginate through all results for this query
        do {
          if (abortRef.current) break;

          const resp: Response = await fetch("/api/sc/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, cursor }),
          });

          if (!resp.ok) {
            console.error(
              `Search failed for "${query}": ${resp.status}`,
              await resp.text()
            );
            break;
          }

          const data: { playlists: SCPlaylist[]; nextCursor: string | null } =
            await resp.json();
          const playlists: SCPlaylist[] = data.playlists || [];

          for (const pl of playlists) {
            if (!seenIds.has(pl.id)) {
              seenIds.add(pl.id);
              allRaw.push(pl);
              foundNames.push(pl.title);
            }
          }

          // Update with newly found names
          actions.setProgress({ foundNames: [...foundNames] });

          cursor = data.nextCursor;
        } while (cursor);
      }

      if (abortRef.current) {
        actions.setProgress({ isRunning: false });
        return;
      }

      // Apply filters
      const filtered = filterPlaylists(allRaw, {
        requireTerms: config.requireTerms,
        requireAllTerms: config.requireAllTerms,
        excludeTerms: config.excludeTerms,
        minTrackCount: config.minTrackCount,
        maxTrackCount: config.maxTrackCount,
        minLikes: config.minLikes,
      });

      // Convert to candidates, rank, and cap
      let candidates = filtered.map(toCandidate);
      candidates = rankPlaylists(candidates, config.rankMode);
      if (config.maxResults > 0) {
        candidates = candidates.slice(0, config.maxResults);
      }

      actions.setPlaylists(candidates);
      actions.setProgress({
        completed: config.queries.length,
        isRunning: false,
      });
    },
    [actions]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { search, abort };
}
