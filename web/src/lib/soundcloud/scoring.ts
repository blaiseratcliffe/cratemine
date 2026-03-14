import type { ScoringWeights, ScoredTrack } from "@/types";
import type { SCTrackRaw } from "./types";
import { BAD_ACCESS_VALUES, DEFAULT_SCORING_WEIGHTS } from "@/lib/config";

/**
 * Convert a raw SC track to a ScoredTrack with computed score.
 */
export function trackToScored(
  raw: SCTrackRaw,
  sourcePlaylistId: number,
  sourcePlaylistTitle: string,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): ScoredTrack {
  const plays = raw.playback_count ?? 0;
  const likes = raw.likes_count ?? raw.favoritings_count ?? 0;
  const reposts = raw.reposts_count ?? 0;
  const comments = raw.comment_count ?? raw.comments_count ?? 0;

  const score =
    weights.play * plays +
    weights.like * likes +
    weights.repost * reposts +
    weights.comment * comments;

  return {
    trackId: raw.id,
    trackUrn: raw.urn ?? null,
    title: raw.title,
    username: raw.user?.username ?? "Unknown",
    playbackCount: plays,
    likesCount: likes,
    repostsCount: reposts,
    commentCount: comments,
    duration: raw.duration ?? 0,
    createdAt: raw.created_at,
    access: raw.access ?? "playable",
    score,
    genre: raw.genre ?? "",
    tagList: raw.tag_list ?? "",
    bpm: raw.bpm ?? null,
    keySignature: raw.key_signature ?? null,
    labelName: raw.label_name ?? null,
    downloadCount: raw.download_count ?? 0,
    permalinkUrl: raw.permalink_url ?? "",
    artistUrl: raw.permalink_url
      ? raw.permalink_url.split("/").slice(0, -1).join("/")
      : "",
    sourcePlaylistId,
    sourcePlaylistTitle,
  };
}

/**
 * Recompute scores for all tracks with new weights.
 */
export function rescoreTracks(
  tracks: ScoredTrack[],
  weights: ScoringWeights
): ScoredTrack[] {
  return tracks.map((t) => ({
    ...t,
    score:
      weights.play * t.playbackCount +
      weights.like * t.likesCount +
      weights.repost * t.repostsCount +
      weights.comment * t.commentCount,
  }));
}

/**
 * Deduplicate tracks. Key: URN if available, else track_id.
 * Keeps the highest-scoring copy.
 */
export function dedupTracks(tracks: ScoredTrack[]): ScoredTrack[] {
  // Sort by score descending first so first-seen is highest
  const sorted = [...tracks].sort(compareTracks);
  const seen = new Map<string, ScoredTrack>();

  for (const track of sorted) {
    const key = track.trackUrn
      ? `urn:${track.trackUrn}`
      : `id:${track.trackId}`;
    if (!seen.has(key)) {
      seen.set(key, track);
    }
  }

  return Array.from(seen.values());
}

/**
 * Sort tracks by score descending, with tie-breakers matching R logic.
 */
export function sortByScore(tracks: ScoredTrack[]): ScoredTrack[] {
  return [...tracks].sort(compareTracks);
}

function compareTracks(a: ScoredTrack, b: ScoredTrack): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.playbackCount !== a.playbackCount)
    return b.playbackCount - a.playbackCount;
  if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
  if (b.repostsCount !== a.repostsCount)
    return b.repostsCount - a.repostsCount;
  if (b.commentCount !== a.commentCount)
    return b.commentCount - a.commentCount;
  // Newer first
  return (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Filter out tracks with bad access values.
 */
export function filterAccess(tracks: ScoredTrack[]): ScoredTrack[] {
  return tracks.filter((t) => !BAD_ACCESS_VALUES.includes(t.access));
}

/**
 * Filter tracks by duration range.
 */
export function filterDuration(
  tracks: ScoredTrack[],
  minSec: number,
  maxSec: number
): ScoredTrack[] {
  const minMs = minSec * 1000;
  const maxMs = maxSec * 1000;
  return tracks.filter((t) => {
    if (!t.duration || t.duration <= 0) return true; // keep tracks with unknown duration
    return t.duration >= minMs && t.duration <= maxMs;
  });
}

/**
 * Full merge pipeline: dedup + filter access + filter duration + sort + cap.
 */
export function mergeTracks(
  tracks: ScoredTrack[],
  weights: ScoringWeights,
  maxTracks?: number,
  durationRange?: { minSec: number; maxSec: number }
): ScoredTrack[] {
  let result = rescoreTracks(tracks, weights);
  result = dedupTracks(result);
  const afterDedup = result.length;
  result = filterAccess(result);
  const afterAccess = result.length;
  if (durationRange) {
    result = filterDuration(result, durationRange.minSec, durationRange.maxSec);
  }
  const afterDuration = result.length;
  result = sortByScore(result);
  if (maxTracks && maxTracks > 0) {
    result = result.slice(0, maxTracks);
  }
  console.log(
    `[MergeTracks] ${tracks.length} input → ${afterDedup} deduped → ${afterAccess} access → ${afterDuration} duration → ${result.length} final (cap ${maxTracks})`
  );
  return result;
}
