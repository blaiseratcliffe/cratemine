import type { PlaylistCandidate } from "@/types";
import type { SCPlaylist } from "./types";

/**
 * Build a searchable text blob from playlist fields (lowercased).
 */
function playlistTextBlob(pl: SCPlaylist): string {
  return [pl.title, pl.description, pl.tag_list, pl.genre]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Check if a playlist matches the given terms.
 */
export function matchesTerms(
  pl: SCPlaylist,
  terms: string[],
  requireAll: boolean
): boolean {
  if (terms.length === 0) return true;
  const blob = playlistTextBlob(pl);
  const hits = terms.map((t) => blob.includes(t.toLowerCase()));
  return requireAll ? hits.every(Boolean) : hits.some(Boolean);
}

/**
 * Check if a playlist matches any exclusion terms.
 */
export function matchesExclude(pl: SCPlaylist, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const blob = playlistTextBlob(pl);
  return terms.some((t) => blob.includes(t.toLowerCase()));
}

/**
 * Convert raw SC playlist to a PlaylistCandidate.
 */
export function toCandidate(pl: SCPlaylist): PlaylistCandidate {
  const trackCount = pl.track_count ?? 0;
  const likesCount = pl.likes_count ?? 0;
  return {
    id: pl.id,
    title: pl.title,
    user: pl.user?.username ?? "Unknown",
    trackCount,
    likesCount,
    likesPerTrack: trackCount > 0 ? likesCount / trackCount : 0,
    permalinkUrl: pl.permalink_url,
    createdAt: pl.created_at,
    selected: true,
  };
}

/**
 * Filter playlists by all search criteria.
 */
export function filterPlaylists(
  playlists: SCPlaylist[],
  config: {
    requireTerms: string[];
    requireAllTerms: boolean;
    excludeTerms: string[];
    minTrackCount: number;
    maxTrackCount: number;
    minLikes: number;
  }
): SCPlaylist[] {
  return playlists.filter((pl) => {
    if (!matchesTerms(pl, config.requireTerms, config.requireAllTerms))
      return false;
    if (matchesExclude(pl, config.excludeTerms)) return false;
    const tc = pl.track_count ?? 0;
    if (tc < config.minTrackCount || tc > config.maxTrackCount) return false;
    if ((pl.likes_count ?? 0) < config.minLikes) return false;
    return true;
  });
}

/**
 * Rank playlists by the chosen mode.
 */
export function rankPlaylists(
  candidates: PlaylistCandidate[],
  mode: "likes" | "likes_per_track" | "recency_likes"
): PlaylistCandidate[] {
  const scored = candidates.map((c) => {
    let rankScore: number;
    switch (mode) {
      case "likes":
        rankScore = c.likesCount;
        break;
      case "likes_per_track":
        rankScore = c.likesPerTrack;
        break;
      case "recency_likes": {
        const ageDays =
          (Date.now() - new Date(c.createdAt).getTime()) / 86_400_000;
        rankScore = c.likesCount * Math.exp(-ageDays / 365);
        break;
      }
    }
    return { ...c, _rankScore: rankScore };
  });

  scored.sort((a, b) => b._rankScore - a._rankScore);

  // Strip internal field
  return scored.map(({ _rankScore: _, ...rest }) => rest);
}
