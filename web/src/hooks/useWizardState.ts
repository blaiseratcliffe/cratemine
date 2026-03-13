"use client";

import { useReducer } from "react";
import type {
  WizardState,
  WizardStep,
  DiscoveryMode,
  ScoringWeights,
  SearchConfig,
  SceneConfig,
  SceneUser,
  SceneEdge,
  SceneProgress,
  ScoredTrack,
  PlaylistCandidate,
  MyPlaylist,
  MergeProgress,
} from "@/types";
import { DEFAULT_SCORING_WEIGHTS, DEFAULT_SEARCH_CONFIG } from "@/lib/config";

const DEFAULT_SCENE_CONFIG: SceneConfig = {
  city: "",
  genreKeywords: "",
  filterTracksByGenre: true,
  seedArtists: "",
  maxSeedUsers: 50,
  minFollowedByCount: 2,
  maxSceneMembers: 200,
  recencyDays: 90,
};

const INITIAL_MERGE_PROGRESS: MergeProgress = {
  phase: "idle",
  completed: 0,
  total: 0,
  currentPlaylist: "",
  isRunning: false,
};

const INITIAL_SCENE_PROGRESS: SceneProgress = {
  phase: "idle",
  completed: 0,
  total: 0,
  currentUser: "",
  isRunning: false,
  seedsFound: 0,
  sceneMembersFound: 0,
  tracksFound: 0,
  foundNames: [],
};

type Action =
  | { type: "SET_STEP"; step: WizardStep }
  | { type: "SET_DISCOVERY_MODE"; mode: DiscoveryMode }
  | { type: "SET_SEARCH_CONFIG"; config: SearchConfig }
  | { type: "SET_PLAYLISTS"; playlists: PlaylistCandidate[] }
  | { type: "ADD_PLAYLISTS"; playlists: PlaylistCandidate[] }
  | { type: "SET_SEARCH_PROGRESS"; progress: Partial<WizardState["searchProgress"]> }
  | { type: "TOGGLE_PLAYLIST"; id: number }
  | { type: "SELECT_ALL_PLAYLISTS"; selected: boolean }
  | { type: "SET_SCENE_CONFIG"; config: SceneConfig }
  | { type: "SET_SCENE_USERS"; users: SceneUser[] }
  | { type: "ADD_SCENE_EDGES"; edges: SceneEdge[] }
  | { type: "SET_SCENE_PROGRESS"; progress: Partial<SceneProgress> }
  | { type: "SET_MY_PLAYLISTS"; playlists: MyPlaylist[] }
  | { type: "TOGGLE_MY_PLAYLIST"; id: number }
  | { type: "SELECT_ALL_MY_PLAYLISTS"; selected: boolean }
  | { type: "SET_MERGE_PROGRESS"; progress: Partial<MergeProgress> }
  | { type: "SET_TRACKS"; tracks: ScoredTrack[] }
  | { type: "ADD_TRACKS"; tracks: ScoredTrack[] }
  | { type: "SET_TRACK_FETCH_PROGRESS"; progress: Partial<WizardState["trackFetchProgress"]> }
  | { type: "SET_MERGED_TRACKS"; tracks: ScoredTrack[] }
  | { type: "SET_SCORING_WEIGHTS"; weights: ScoringWeights }
  | { type: "SET_MAX_TRACKS"; max: number }
  | { type: "SET_OUTPUT_TITLE"; title: string }
  | { type: "SET_OUTPUT_SHARING"; sharing: "public" | "private" }
  | { type: "SET_CREATION_PROGRESS"; progress: Partial<WizardState["creationProgress"]> }
  | { type: "ADD_CREATED_PLAYLIST"; playlist: { id: number; title: string; trackCount: number; url: string } }
  | { type: "RESET" };

const initialState: WizardState = {
  discoveryMode: "playlists",
  step: "search",
  searchConfig: DEFAULT_SEARCH_CONFIG,
  playlists: [],
  searchProgress: { completed: 0, total: 0, currentQuery: "", isRunning: false, foundNames: [] },
  sceneConfig: DEFAULT_SCENE_CONFIG,
  sceneUsers: [],
  sceneEdges: [],
  sceneProgress: INITIAL_SCENE_PROGRESS,
  myPlaylists: [],
  mergeProgress: INITIAL_MERGE_PROGRESS,
  tracks: [],
  trackFetchProgress: { completed: 0, total: 0, currentPlaylist: "", isRunning: false },
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  mergedTracks: [],
  maxTracksToRetain: 500,
  outputTitle: "",
  outputSharing: "public",
  creationProgress: {
    partsCreated: 0,
    tracksAdded: 0,
    tracksFailed: 0,
    currentPart: 0,
    done: false,
    isRunning: false,
  },
  createdPlaylists: [],
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_DISCOVERY_MODE":
      return { ...state, discoveryMode: action.mode };
    case "SET_SEARCH_CONFIG":
      return { ...state, searchConfig: action.config };
    case "SET_PLAYLISTS":
      return { ...state, playlists: action.playlists };
    case "ADD_PLAYLISTS": {
      const existingIds = new Set(state.playlists.map((p) => p.id));
      const newOnes = action.playlists.filter((p) => !existingIds.has(p.id));
      return { ...state, playlists: [...state.playlists, ...newOnes] };
    }
    case "SET_SEARCH_PROGRESS":
      return {
        ...state,
        searchProgress: { ...state.searchProgress, ...action.progress },
      };
    case "TOGGLE_PLAYLIST":
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === action.id ? { ...p, selected: !p.selected } : p
        ),
      };
    case "SELECT_ALL_PLAYLISTS":
      return {
        ...state,
        playlists: state.playlists.map((p) => ({ ...p, selected: action.selected })),
      };
    case "SET_SCENE_CONFIG":
      return { ...state, sceneConfig: action.config };
    case "SET_SCENE_USERS":
      // Clear edges when resetting users (new discovery starts with empty array)
      return action.users.length === 0
        ? { ...state, sceneUsers: [], sceneEdges: [] }
        : { ...state, sceneUsers: action.users };
    case "ADD_SCENE_EDGES":
      return { ...state, sceneEdges: [...state.sceneEdges, ...action.edges] };
    case "SET_SCENE_PROGRESS":
      return {
        ...state,
        sceneProgress: { ...state.sceneProgress, ...action.progress },
      };
    case "SET_MY_PLAYLISTS":
      return { ...state, myPlaylists: action.playlists };
    case "TOGGLE_MY_PLAYLIST":
      return {
        ...state,
        myPlaylists: state.myPlaylists.map((p) =>
          p.id === action.id ? { ...p, selected: !p.selected } : p
        ),
      };
    case "SELECT_ALL_MY_PLAYLISTS":
      return {
        ...state,
        myPlaylists: state.myPlaylists.map((p) => ({ ...p, selected: action.selected })),
      };
    case "SET_MERGE_PROGRESS":
      return {
        ...state,
        mergeProgress: { ...state.mergeProgress, ...action.progress },
      };
    case "SET_TRACKS":
      return { ...state, tracks: action.tracks };
    case "ADD_TRACKS":
      return { ...state, tracks: [...state.tracks, ...action.tracks] };
    case "SET_TRACK_FETCH_PROGRESS":
      return {
        ...state,
        trackFetchProgress: { ...state.trackFetchProgress, ...action.progress },
      };
    case "SET_MERGED_TRACKS":
      return { ...state, mergedTracks: action.tracks };
    case "SET_SCORING_WEIGHTS":
      return { ...state, scoringWeights: action.weights };
    case "SET_MAX_TRACKS":
      return { ...state, maxTracksToRetain: action.max };
    case "SET_OUTPUT_TITLE":
      return { ...state, outputTitle: action.title };
    case "SET_OUTPUT_SHARING":
      return { ...state, outputSharing: action.sharing };
    case "SET_CREATION_PROGRESS":
      return {
        ...state,
        creationProgress: { ...state.creationProgress, ...action.progress },
      };
    case "ADD_CREATED_PLAYLIST":
      return {
        ...state,
        createdPlaylists: [...state.createdPlaylists, action.playlist],
      };
    case "RESET":
      return { ...initialState };
    default:
      return state;
  }
}

export function useWizardState() {
  return useReducer(reducer, initialState);
}
