import type { SCUserFull, SCTrackRaw } from "./types";
import type { SceneUser, ScoredTrack, ScoringWeights } from "@/types";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/config";
import { trackToScored } from "./scoring";

/**
 * Score how well a user's city field matches the target city.
 * Returns: 1.0 exact, 0.9 prefix, 0 no match.
 */
export function cityFieldScore(userCity: string | null, targetCity: string): number {
  if (!userCity) return 0;
  const target = targetCity.toLowerCase().trim();
  const city = userCity.toLowerCase().trim();
  if (city === target) return 1.0;
  if (city.startsWith(target + ",") || city.startsWith(target + " ")) return 0.9;
  return 0;
}

/**
 * Score how well a user matches a target city across all profile fields.
 * Checks city field first (strongest signal), then description, then username.
 */
export function cityMatchScore(
  user: { city?: string | null; description?: string | null; username?: string },
  targetCity: string
): number {
  // Best signal: structured city field
  const fieldScore = cityFieldScore(user.city ?? null, targetCity);
  if (fieldScore > 0) return fieldScore;

  const target = targetCity.toLowerCase().trim();

  // Medium signal: city mentioned in description
  if (user.description) {
    const desc = user.description.toLowerCase();
    if (desc.includes(target)) return 0.6;
  }

  // Weak signal: city in username (e.g. "BristolBassCollective")
  if (user.username) {
    const name = user.username.toLowerCase();
    if (name.includes(target)) return 0.4;
  }

  return 0;
}

export function cityMatches(userCity: string | null, targetCity: string): boolean {
  return cityFieldScore(userCity, targetCity) > 0;
}

/**
 * Score a seed user by composite quality signal.
 *
 * seedScore = cityConfidence × activitySignal × connectednessRatio × followerBand
 *
 * - cityConfidence: exact match (1.0) vs prefix match (0.9)
 * - activitySignal: min(track_count, 50) / 50
 * - connectednessRatio: min(followings, 500) / max(followers, 1) capped at 1.0
 * - followerBand: >=500 → 1.0, 100-499 → 0.8, 0-99 → 0.5
 */
export function scoreSeedUser(user: SCUserFull, cityInput: string): number {
  const cities = parseCities(cityInput);

  // Take the best city match across all cities
  let bestCityConf = 0;
  for (const city of cities) {
    bestCityConf = Math.max(bestCityConf, cityMatchScore(user, city));
  }
  if (bestCityConf === 0) return 0;

  const tracks = user.track_count ?? 0;
  if (tracks === 0) return 0;

  const activitySignal = Math.min(tracks, 50) / 50;

  const followers = user.followers_count ?? 0;
  const followings = user.followings_count ?? 0;
  const connectedness = Math.min(Math.min(followings, 500) / Math.max(followers, 1), 1.0);

  const followerBand = followers >= 500 ? 1.0 : followers >= 100 ? 0.8 : 0.5;

  return bestCityConf * activitySignal * connectedness * followerBand;
}

/**
 * Filter and rank seed users by composite seed score.
 */
export function filterSeedUsers(
  users: SCUserFull[],
  cityInput: string,
  maxSeeds: number
): SCUserFull[] {
  return users
    .filter((u) => scoreSeedUser(u, cityInput) > 0)
    .sort((a, b) => scoreSeedUser(b, cityInput) - scoreSeedUser(a, cityInput))
    .slice(0, maxSeeds);
}

/**
 * Validate seeds using mutual-follow density.
 * After fetching all seed followings, check which seeds follow each other.
 * Returns seeds sorted by mutualScore descending, with isolated seeds demoted.
 */
export function validateSeedsByMutualFollows(
  seeds: SCUserFull[],
  allFollowings: Map<number, SCUserFull[]>
): SCUserFull[] {
  const seedIdSet = new Set(seeds.map((s) => s.id));

  // For each seed, count how many other seeds appear in their followings
  const mutualScores = new Map<number, number>();
  for (const seed of seeds) {
    const followings = allFollowings.get(seed.id) || [];
    let score = 0;
    for (const f of followings) {
      if (seedIdSet.has(f.id) && f.id !== seed.id) {
        score++;
      }
    }
    mutualScores.set(seed.id, score);
  }

  // Sort: seeds with mutual connections first, then by their mutual score
  return [...seeds].sort((a, b) => {
    const sa = mutualScores.get(a.id) ?? 0;
    const sb = mutualScores.get(b.id) ?? 0;
    return sb - sa;
  });
}

/**
 * Parse a city input string into individual city names.
 * Supports comma-separated values: "Bristol, Auckland" → ["Bristol", "Auckland"]
 */
export function parseCities(input: string): string[] {
  return input
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Parse seed artist input into SoundCloud URLs for resolving.
 * Accepts full URLs or usernames (one per line or comma-separated).
 * "kojiaikendnb" → "https://soundcloud.com/kojiaikendnb"
 * "https://soundcloud.com/kojiaikendnb" → as-is
 */
export function parseSeedArtistUrls(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (s.startsWith("http")) return s;
      // Strip leading @ or / if pasted from somewhere
      const clean = s.replace(/^[@/]+/, "");
      return `https://soundcloud.com/${clean}`;
    });
}

/**
 * Check if a user's profile matches genre keywords.
 * Checks description and username.
 */
export function userMatchesGenre(
  user: { description?: string | null; username?: string },
  genreKeywords: string[]
): boolean {
  if (genreKeywords.length === 0) return false;

  const desc = (user.description || "").toLowerCase();
  const name = (user.username || "").toLowerCase();

  for (const kw of genreKeywords) {
    if (desc.includes(kw) || name.includes(kw)) return true;
  }
  return false;
}

/**
 * Parse a comma-separated keyword string into lowercase terms.
 */
export function parseGenreKeywords(input: string): string[] {
  return input
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
}

/**
 * Generate multiple search queries for cities to widen the seed net.
 * If genre keywords are provided, they're combined with city names
 * to bias seeds toward the right genre.
 */
export function buildSeedSearchQueries(cityInput: string, genreKeywords?: string): string[] {
  const cities = parseCities(cityInput);
  const genres = genreKeywords ? parseGenreKeywords(genreKeywords) : [];
  const queries: string[] = [];

  for (const city of cities) {
    queries.push(city, `${city} DJ`, `${city} producer`);
    // Add genre-biased queries
    for (const genre of genres) {
      queries.push(`${city} ${genre}`);
    }
    // If no genres specified, add a generic music query
    if (genres.length === 0) {
      queries.push(`${city} music`);
    }
  }
  return queries;
}

/**
 * Check if a track matches any of the genre keywords.
 * Matches against genre field, tag_list, and title.
 * Returns true if no keywords are specified (no filtering).
 */
export function trackMatchesGenre(
  track: SCTrackRaw,
  genreKeywords: string[]
): boolean {
  if (genreKeywords.length === 0) return true;

  const genre = (track.genre || "").toLowerCase();
  const tags = (track.tag_list || "").toLowerCase();
  const title = (track.title || "").toLowerCase();

  for (const keyword of genreKeywords) {
    if (genre.includes(keyword)) return true;
    if (tags.includes(keyword)) return true;
    if (title.includes(keyword)) return true;
  }
  return false;
}

/**
 * Build the scene graph from seed users' followings.
 * Returns users followed by at least `minFollowedBy` seeds.
 */
export function buildSceneGraph(
  seedIds: Set<number>,
  allFollowings: Map<number, SCUserFull[]>, // seedId -> their followings
  minFollowedBy: number,
  maxMembers: number
): SceneUser[] {
  // Count how many seeds follow each user
  const followedByCount = new Map<number, { user: SCUserFull; count: number }>();

  for (const [, followings] of allFollowings) {
    for (const user of followings) {
      const existing = followedByCount.get(user.id);
      if (existing) {
        existing.count++;
      } else {
        followedByCount.set(user.id, { user, count: 1 });
      }
    }
  }

  // Scene members: followed by >= minFollowedBy seeds
  const members: SceneUser[] = [];

  for (const [userId, { user, count }] of followedByCount) {
    if (count >= minFollowedBy || seedIds.has(userId)) {
      members.push({
        id: user.id,
        username: user.username,
        permalinkUrl: user.permalink_url ?? "",
        city: user.city,
        followersCount: user.followers_count ?? 0,
        trackCount: user.track_count ?? 0,
        followedByCount: count,
        isSeed: seedIds.has(userId),
      });
    }
  }

  // Also ensure all seeds are included even if not in anyone's followings
  for (const seedId of seedIds) {
    if (!members.some((m) => m.id === seedId)) {
      // Seed wasn't in any following list — we don't have their full data here,
      // but they'll be added by the hook which has the seed user objects
    }
  }

  // Sort by followedByCount descending (most central first), then by followers
  members.sort((a, b) => {
    if (b.followedByCount !== a.followedByCount)
      return b.followedByCount - a.followedByCount;
    return b.followersCount - a.followersCount;
  });

  return members.slice(0, maxMembers);
}

/**
 * Score tracks by repost velocity and local scene signal.
 *
 * momentum = velocity * (1 + localSignal) * recency_boost
 * where:
 *   velocity = reposts_count / max(age_days, 1)
 *   localSignal = 1 (uploaded by a scene member — always true here)
 *   recency_boost = exp(-age_days / 30)
 */
export function scoreByMomentum(
  tracks: SCTrackRaw[],
  sceneMemberIds: Set<number>,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  recencyDays: number = 90,
  genreKeywords: string[] = []
): ScoredTrack[] {
  const now = Date.now();
  const cutoff = now - recencyDays * 86_400_000;

  const results: ScoredTrack[] = [];
  let skippedOld = 0;
  let skippedGenre = 0;

  for (const raw of tracks) {
    const createdMs = new Date(raw.created_at).getTime();
    if (createdMs < cutoff) { skippedOld++; continue; }

    if (!trackMatchesGenre(raw, genreKeywords)) { skippedGenre++; continue; }

    const ageDays = Math.max((now - createdMs) / 86_400_000, 1);
    const reposts = raw.reposts_count ?? 0;
    const velocity = reposts / ageDays;

    // localSignal: how many scene members are connected to this track
    // The uploader is always 1; we could enhance this later with likes data
    const localSignal = sceneMemberIds.has(raw.user?.id) ? 1 : 0;

    const recencyBoost = Math.exp(-ageDays / 30);
    const momentum = velocity * (1 + localSignal) * recencyBoost;

    const scored = trackToScored(raw, 0, "Scene Discovery", weights);
    results.push({
      ...scored,
      velocity,
      localSignal,
      momentum,
      ageDays: Math.round(ageDays),
    });
  }

  console.log(
    `[SceneScoring] ${tracks.length} raw → ${results.length} scored ` +
    `(${skippedOld} older than ${recencyDays}d, ${skippedGenre} genre mismatch)`
  );

  // Sort by momentum descending
  results.sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0));

  return results;
}
