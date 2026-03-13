// App-level types

export interface ScoringWeights {
  play: number;
  like: number;
  repost: number;
  comment: number;
}

export interface SearchConfig {
  queries: string[];
  requireTerms: string[];
  requireAllTerms: boolean;
  excludeTerms: string[];
  minTrackCount: number;
  maxTrackCount: number;
  minLikes: number;
  rankMode: "likes" | "likes_per_track" | "recency_likes";
  maxResults: number;
}

export interface ScoredTrack {
  trackId: number;
  trackUrn: string | null;
  title: string;
  username: string;
  playbackCount: number;
  likesCount: number;
  repostsCount: number;
  commentCount: number;
  createdAt: string;
  access: string;
  score: number;
  sourcePlaylistId: number;
  permalinkUrl: string;
  artistUrl: string;
  sourcePlaylistTitle: string;
  // Scene discovery fields (optional)
  velocity?: number;
  localSignal?: number;
  momentum?: number;
  ageDays?: number;
}

export interface PlaylistCandidate {
  id: number;
  title: string;
  user: string;
  trackCount: number;
  likesCount: number;
  likesPerTrack: number;
  permalinkUrl: string;
  createdAt: string;
  selected: boolean;
}

// --- Merge playlists types ---

export interface MyPlaylist {
  id: number;
  title: string;
  trackCount: number;
  likesCount: number;
  sharing: string;
  createdAt: string;
  permalinkUrl: string;
  selected: boolean;
}

export interface MergeProgress {
  phase: "idle" | "loading" | "fetching" | "done";
  completed: number;
  total: number;
  currentPlaylist: string;
  isRunning: boolean;
}

// --- Scene discovery types ---

export interface SceneConfig {
  city: string;
  genreKeywords: string;
  filterTracksByGenre: boolean;
  seedArtists: string;
  maxSeedUsers: number;
  minFollowedByCount: number;
  maxSceneMembers: number;
  recencyDays: number;
}

export interface SceneUser {
  id: number;
  username: string;
  permalinkUrl: string;
  city: string | null;
  followersCount: number;
  trackCount: number;
  followedByCount: number;
  isSeed: boolean;
}

export interface SceneEdge {
  source: number;
  target: number;
}

export interface SceneProgress {
  phase: "idle" | "seeds" | "graph" | "tracks" | "done";
  completed: number;
  total: number;
  currentUser: string;
  isRunning: boolean;
  seedsFound: number;
  sceneMembersFound: number;
  tracksFound: number;
  foundNames: string[];
}

// --- Wizard types ---

export type DiscoveryMode = "playlists" | "scene" | "merge";

export type WizardStep = "search" | "scene" | "merge" | "select" | "preview" | "create";

export interface WizardState {
  discoveryMode: DiscoveryMode;
  step: WizardStep;
  searchConfig: SearchConfig;
  // Search results
  playlists: PlaylistCandidate[];
  searchProgress: {
    completed: number;
    total: number;
    currentQuery: string;
    isRunning: boolean;
    foundNames: string[];
  };
  // Scene discovery
  sceneConfig: SceneConfig;
  sceneUsers: SceneUser[];
  sceneEdges: SceneEdge[];
  sceneProgress: SceneProgress;
  // Merge playlists
  myPlaylists: MyPlaylist[];
  mergeProgress: MergeProgress;
  // Track fetching
  tracks: ScoredTrack[];
  trackFetchProgress: {
    completed: number;
    total: number;
    currentPlaylist: string;
    isRunning: boolean;
  };
  // Preview / scoring
  scoringWeights: ScoringWeights;
  mergedTracks: ScoredTrack[];
  maxTracksToRetain: number;
  // Creation
  outputTitle: string;
  outputSharing: "public" | "private";
  creationProgress: {
    partsCreated: number;
    tracksAdded: number;
    tracksFailed: number;
    currentPart: number;
    done: boolean;
    isRunning: boolean;
  };
  createdPlaylists: { id: number; title: string; trackCount: number; url: string }[];
}
