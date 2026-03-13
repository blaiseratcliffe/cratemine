import type { ScoringWeights, SearchConfig } from "@/types";

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  play: 1,
  like: 50,
  repost: 200,
  comment: 10,
};

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  queries: ["dnb", "dnb bootleg", "drum and bass"],
  requireTerms: [],
  requireAllTerms: false,
  excludeTerms: ["podcast", "episode", "audiobook", "lecture"],
  minTrackCount: 10,
  maxTrackCount: 500,
  minLikes: 0,
  rankMode: "likes_per_track",
  maxResults: 80,
};

export const MAX_PER_PLAYLIST = 500;

export const BAD_ACCESS_VALUES = [
  "blocked",
  "preview",
  "no_rights",
  "snipped",
  "unknown",
];

export const SC_API_BASE = "https://api.soundcloud.com";
export const SC_AUTH_BASE = "https://secure.soundcloud.com";
