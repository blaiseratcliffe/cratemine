"use client";

import { useCallback, useRef } from "react";
import type { SCUserFull, SCTrackRaw } from "@/lib/soundcloud/types";
import type {
  SceneConfig,
  SceneUser,
  SceneEdge,
  SceneProgress,
  ScoredTrack,
  ScoringWeights,
} from "@/types";
import {
  filterSeedUsers,
  buildSeedSearchQueries,
  parseGenreKeywords,
  parseSeedArtistUrls,
  userMatchesGenre,
  validateSeedsByMutualFollows,
  buildSceneGraph,
  scoreByMomentum,
} from "@/lib/soundcloud/scene";

interface SceneMapActions {
  setProgress: (progress: Partial<SceneProgress>) => void;
  setSceneUsers: (users: SceneUser[]) => void;
  addEdges: (edges: SceneEdge[]) => void;
  setTracks: (tracks: ScoredTrack[]) => void;
  addTracks: (tracks: ScoredTrack[]) => void;
}

/** Max pages to paginate per search query */
const MAX_PAGES_PER_QUERY = 3;

/** Max additional seeds to promote from 2-hop genre crawl */
const MAX_GENRE_PROMOTED_SEEDS = 20;

export function useSCSceneMap(actions: SceneMapActions) {
  const abortRef = useRef(false);

  const discover = useCallback(
    async (config: SceneConfig, weights: ScoringWeights) => {
      abortRef.current = false;

      actions.setTracks([]);
      actions.setSceneUsers([]);
      actions.setProgress({
        phase: "seeds",
        completed: 0,
        total: 0,
        currentUser: "",
        isRunning: true,
        seedsFound: 0,
        sceneMembersFound: 0,
        tracksFound: 0,
        foundNames: [],
      });

      // ========== PHASE 1: SEED DISCOVERY ==========
      const allUsers: SCUserFull[] = [];
      const seenIds = new Set<number>();

      // --- 1a. Resolve manual seed artists (#6) ---
      const manualSeeds: SCUserFull[] = [];
      const seedUrls = parseSeedArtistUrls(config.seedArtists);
      for (const url of seedUrls) {
        if (abortRef.current) break;

        const resp = await fetch("/api/sc/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        if (resp.ok) {
          const data: { user: SCUserFull } = await resp.json();
          if (data.user && !seenIds.has(data.user.id)) {
            seenIds.add(data.user.id);
            manualSeeds.push(data.user);
            allUsers.push(data.user);
          }
        } else {
          console.warn(`[SceneMap] Failed to resolve seed artist: ${url}`);
        }
      }

      if (manualSeeds.length > 0) {
        console.log(`[SceneMap] ${manualSeeds.length} manual seed artist(s) resolved`);
      }

      // --- 1b. Search with multiple queries, paginated (#2) ---
      // Skip city search if user wants seeds only
      const queries = config.seedsOnly ? [] : buildSeedSearchQueries(config.city, config.genreKeywords);
      for (const query of queries) {
        if (abortRef.current) break;

        let cursor: string | null = null;
        for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
          const resp: Response = await fetch("/api/sc/users/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cursor ? { cursor } : { query }),
          });

          if (!resp.ok) {
            if (page === 0) {
              console.error(`User search "${query}" failed: ${resp.status}`);
            }
            break;
          }

          const data: { users: SCUserFull[]; nextCursor: string | null } =
            await resp.json();
          const users = data.users || [];

          for (const u of users) {
            if (!seenIds.has(u.id)) {
              seenIds.add(u.id);
              allUsers.push(u);
            }
          }

          // Stop if no more pages or very few results
          if (!data.nextCursor || users.length < 50) break;
          cursor = data.nextCursor;
        }
      }

      if (abortRef.current) {
        actions.setProgress({ isRunning: false, phase: "idle" });
        return;
      }

      // Filter and rank by composite seed score
      console.log(
        `[SceneMap] ${allUsers.length} users from ${queries.length} queries + ${manualSeeds.length} manual, ` +
        `${allUsers.filter((u) => u.city).length} have city field set`
      );
      const seeds = config.seedsOnly
        ? [...manualSeeds]  // Seeds-only mode: skip city filtering
        : filterSeedUsers(allUsers, config.city, config.maxSeedUsers);

      // Ensure manual seeds are always included even if city filter would drop them
      const manualSeedIds = new Set(manualSeeds.map((s) => s.id));
      for (const ms of manualSeeds) {
        if (!seeds.some((s) => s.id === ms.id)) {
          seeds.push(ms);
        }
      }

      console.log(`[SceneMap] ${seeds.length} seeds after scoring/filtering (${manualSeeds.length} manual)`);
      const seedIds = new Set(seeds.map((s) => s.id));

      const seedNames = seeds.map((s) => s.username);
      actions.setProgress({
        seedsFound: seeds.length,
        foundNames: [...seedNames],
        phase: "graph",
        total: seeds.length,
        completed: 0,
      });

      if (seeds.length === 0) {
        actions.setProgress({ isRunning: false, phase: "done" });
        return;
      }

      // ========== PHASE 2: GRAPH EXPANSION ==========
      // Emit seed nodes immediately so the graph starts showing
      actions.setSceneUsers(
        seeds.map((s) => ({
          id: s.id,
          username: s.username,
          permalinkUrl: s.permalink_url ?? "",
          city: s.city,
          followersCount: s.followers_count ?? 0,
          trackCount: s.track_count ?? 0,
          followedByCount: 0,
          isSeed: true,
        }))
      );

      const allFollowings = new Map<number, SCUserFull[]>();

      for (let i = 0; i < seeds.length; i++) {
        if (abortRef.current) break;

        const seed = seeds[i];
        actions.setProgress({
          completed: i,
          currentUser: seed.username,
        });

        const resp = await fetch(`/api/sc/users/${seed.id}/followings`);
        if (!resp.ok) continue;

        const data: { users: SCUserFull[] } = await resp.json();
        const followings = data.users || [];
        allFollowings.set(seed.id, followings);

        // Emit edges for this seed so the graph grows progressively
        const edges: SceneEdge[] = followings.map((u) => ({
          source: seed.id,
          target: u.id,
        }));
        actions.addEdges(edges);
      }

      if (abortRef.current) {
        actions.setProgress({ isRunning: false, phase: "idle" });
        return;
      }

      // --- 2-hop genre expansion (#4) ---
      // Scan seed followings for users who match genre keywords but aren't already seeds.
      // Promote the top ones to seeds and fetch their followings too.
      const genreKw = parseGenreKeywords(config.genreKeywords);
      if (genreKw.length > 0) {
        const candidateScores = new Map<number, { user: SCUserFull; followedBySeeds: number }>();

        for (const [, followings] of allFollowings) {
          for (const u of followings) {
            if (seedIds.has(u.id)) continue;
            const existing = candidateScores.get(u.id);
            if (existing) {
              existing.followedBySeeds++;
            } else if (userMatchesGenre(u, genreKw)) {
              candidateScores.set(u.id, { user: u, followedBySeeds: 1 });
            }
          }
        }

        // Rank by how many seeds follow them (most connected genre matches first)
        const promoted = [...candidateScores.values()]
          .filter((c) => c.followedBySeeds >= 2 && (c.user.track_count ?? 0) > 0)
          .sort((a, b) => b.followedBySeeds - a.followedBySeeds)
          .slice(0, MAX_GENRE_PROMOTED_SEEDS);

        if (promoted.length > 0) {
          console.log(
            `[SceneMap] Promoting ${promoted.length} genre-matching artists to seeds ` +
            `(2-hop expansion): ${promoted.map((p) => p.user.username).join(", ")}`
          );

          actions.setProgress({
            total: seeds.length + promoted.length,
            completed: seeds.length,
          });

          for (let i = 0; i < promoted.length; i++) {
            if (abortRef.current) break;

            const { user } = promoted[i];
            seeds.push(user);
            seedIds.add(user.id);

            actions.setProgress({
              completed: seeds.length - promoted.length + i,
              currentUser: `${user.username} (expanded)`,
            });

            const resp = await fetch(`/api/sc/users/${user.id}/followings`);
            if (!resp.ok) continue;

            const data: { users: SCUserFull[] } = await resp.json();
            const followings = data.users || [];
            allFollowings.set(user.id, followings);

            const edges: SceneEdge[] = followings.map((u) => ({
              source: user.id,
              target: u.id,
            }));
            actions.addEdges(edges);
          }

          actions.setProgress({
            seedsFound: seeds.length,
            foundNames: seeds.map((s) => s.username),
          });
        }
      }

      if (abortRef.current) {
        actions.setProgress({ isRunning: false, phase: "idle" });
        return;
      }

      // Validate seeds by mutual-follow density — demote isolated seeds
      const validatedSeeds = validateSeedsByMutualFollows(seeds, allFollowings);
      // Drop seeds with zero mutual connections if we have enough connected ones
      // (but never drop manual seeds)
      const connectedSeeds = validatedSeeds.filter((s) => {
        if (manualSeedIds.has(s.id)) return true;
        const followings = allFollowings.get(s.id) || [];
        return followings.some((f) => seedIds.has(f.id) && f.id !== s.id);
      });
      const finalSeeds =
        connectedSeeds.length >= 3 ? connectedSeeds : validatedSeeds;
      const finalSeedIds = new Set(finalSeeds.map((s) => s.id));

      // Only use validated seeds' followings for graph construction
      const validatedFollowings = new Map<number, SCUserFull[]>();
      for (const seed of finalSeeds) {
        const f = allFollowings.get(seed.id);
        if (f) validatedFollowings.set(seed.id, f);
      }

      // Build scene graph
      const sceneMembers = buildSceneGraph(
        finalSeedIds,
        validatedFollowings,
        config.minFollowedByCount,
        config.maxSceneMembers
      );

      // Ensure seeds are in the list
      for (const seed of finalSeeds) {
        if (!sceneMembers.some((m) => m.id === seed.id)) {
          sceneMembers.push({
            id: seed.id,
            username: seed.username,
            permalinkUrl: seed.permalink_url ?? "",
            city: seed.city,
            followersCount: seed.followers_count ?? 0,
            trackCount: seed.track_count ?? 0,
            followedByCount: 0,
            isSeed: true,
          });
        }
      }

      actions.setSceneUsers(sceneMembers);

      const finalSeedNames = finalSeeds.map((s) => s.username);
      const memberNames = sceneMembers
        .filter((m) => !finalSeedIds.has(m.id))
        .map((m) => m.username);
      actions.setProgress({
        seedsFound: finalSeeds.length,
        sceneMembersFound: sceneMembers.length,
        foundNames: [...finalSeedNames, ...memberNames],
        phase: "tracks",
        total: sceneMembers.length,
        completed: 0,
      });

      // ========== PHASE 3: TRACK DISCOVERY ==========
      const sceneMemberIds = new Set(sceneMembers.map((m) => m.id));
      const allTracks: SCTrackRaw[] = [];
      const seenTrackIds = new Set<number>();

      for (let i = 0; i < sceneMembers.length; i++) {
        if (abortRef.current) break;

        const member = sceneMembers[i];
        if ((member.trackCount ?? 0) === 0) continue;

        actions.setProgress({
          completed: i,
          currentUser: member.username,
        });

        const resp = await fetch(`/api/sc/users/${member.id}/tracks`);
        if (!resp.ok) continue;

        const data: { tracks: SCTrackRaw[] } = await resp.json();
        for (const t of data.tracks || []) {
          if (!seenTrackIds.has(t.id)) {
            seenTrackIds.add(t.id);
            allTracks.push(t);
          }
        }

        actions.setProgress({ tracksFound: allTracks.length });
      }

      if (abortRef.current) {
        actions.setProgress({ isRunning: false, phase: "idle" });
        return;
      }

      // ========== PHASE 4: VELOCITY SCORING ==========
      const trackGenreKw = config.filterTracksByGenre
        ? parseGenreKeywords(config.genreKeywords)
        : [];
      const scored = scoreByMomentum(
        allTracks,
        sceneMemberIds,
        weights,
        config.recencyDays,
        trackGenreKw
      );

      actions.setTracks(scored);
      actions.setProgress({
        phase: "done",
        isRunning: false,
        completed: sceneMembers.length,
        tracksFound: scored.length,
      });
    },
    [actions]
  );

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { discover, abort };
}
