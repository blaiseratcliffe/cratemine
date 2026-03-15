"use client";

import { useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWizardState } from "@/hooks/useWizardState";
import { useSCSearch } from "@/hooks/useSCSearch";
import { useSCTrackFetch } from "@/hooks/useSCTrackFetch";
import { useSCPlaylistCreate } from "@/hooks/useSCPlaylistCreate";
import { useSCSceneMap } from "@/hooks/useSCSceneMap";
import { useSCMyPlaylists } from "@/hooks/useSCMyPlaylists";
import { SearchStep } from "./SearchStep";
import { SelectStep } from "./SelectStep";
import { PreviewStep } from "./PreviewStep";
import { CreateStep } from "./CreateStep";
import { SceneStep } from "./SceneStep";
import { MergeStep } from "./MergeStep";
import { DownloadStep } from "./DownloadStep";
import type {
  DiscoveryMode,
  MyPlaylist,
  MergeProgress,
  PlaylistCandidate,
  SceneEdge,
  SceneProgress,
  SceneUser,
  ScoredTrack,
  WizardStep,
} from "@/types";

import { getEffectivePlan } from "@/lib/plans";

export function WizardShell({
  isAdmin = false,
  plan = "free",
  role = "user",
}: {
  isAdmin?: boolean;
  plan?: string;
  role?: string;
}) {
  const planConfig = getEffectivePlan(plan, role);
  const [state, dispatch] = useWizardState();

  // --- Search actions ---
  const searchActions = useMemo(
    () => ({
      setPlaylists: (playlists: PlaylistCandidate[]) =>
        dispatch({ type: "SET_PLAYLISTS", playlists }),
      addPlaylists: (playlists: PlaylistCandidate[]) =>
        dispatch({ type: "ADD_PLAYLISTS", playlists }),
      setProgress: (progress: {
        completed?: number;
        total?: number;
        currentQuery?: string;
        isRunning?: boolean;
        foundNames?: string[];
      }) => dispatch({ type: "SET_SEARCH_PROGRESS", progress }),
    }),
    [dispatch]
  );

  const trackActions = useMemo(
    () => ({
      setTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "SET_TRACKS", tracks }),
      addTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "ADD_TRACKS", tracks }),
      setProgress: (progress: {
        completed?: number;
        total?: number;
        currentPlaylist?: string;
        isRunning?: boolean;
      }) => dispatch({ type: "SET_TRACK_FETCH_PROGRESS", progress }),
    }),
    [dispatch]
  );

  const createActions = useMemo(
    () => ({
      setProgress: (progress: {
        partsCreated?: number;
        tracksAdded?: number;
        tracksFailed?: number;
        currentPart?: number;
        done?: boolean;
        isRunning?: boolean;
      }) => dispatch({ type: "SET_CREATION_PROGRESS", progress }),
      addCreatedPlaylist: (playlist: {
        id: number;
        title: string;
        trackCount: number;
        url: string;
      }) => dispatch({ type: "ADD_CREATED_PLAYLIST", playlist }),
    }),
    [dispatch]
  );

  // --- Scene actions ---
  const sceneActions = useMemo(
    () => ({
      setProgress: (progress: Partial<SceneProgress>) =>
        dispatch({ type: "SET_SCENE_PROGRESS", progress }),
      setSceneUsers: (users: SceneUser[]) =>
        dispatch({ type: "SET_SCENE_USERS", users }),
      addSceneUsers: (users: SceneUser[]) =>
        dispatch({ type: "ADD_SCENE_USERS", users }),
      addEdges: (edges: SceneEdge[]) =>
        dispatch({ type: "ADD_SCENE_EDGES", edges }),
      setTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "SET_TRACKS", tracks }),
      addTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "ADD_TRACKS", tracks }),
    }),
    [dispatch]
  );

  // --- Merge actions ---
  const mergeActions = useMemo(
    () => ({
      setMyPlaylists: (playlists: MyPlaylist[]) =>
        dispatch({ type: "SET_MY_PLAYLISTS", playlists }),
      setMergeProgress: (progress: Partial<MergeProgress>) =>
        dispatch({ type: "SET_MERGE_PROGRESS", progress }),
      setTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "SET_TRACKS", tracks }),
      addTracks: (tracks: ScoredTrack[]) =>
        dispatch({ type: "ADD_TRACKS", tracks }),
    }),
    [dispatch]
  );

  const { search, abort: abortSearch } = useSCSearch(searchActions);
  const { fetchTracks } = useSCTrackFetch(trackActions);
  const { createPlaylists } = useSCPlaylistCreate(createActions);
  const { discover: discoverScene, abort: abortScene } =
    useSCSceneMap(sceneActions);
  const {
    loadPlaylists: loadMyPlaylists,
    fetchSelectedTracks: fetchMergeTracks,
    abort: abortMerge,
  } = useSCMyPlaylists(mergeActions);

  const handleFetchTracks = useCallback(() => {
    const selected = state.playlists.filter((p) => p.selected);
    fetchTracks(selected, state.scoringWeights);
  }, [state.playlists, state.scoringWeights, fetchTracks]);

  const handleCreate = useCallback(() => {
    createPlaylists(state.mergedTracks, state.outputTitle, state.outputSharing);
  }, [state.mergedTracks, state.outputTitle, state.outputSharing, createPlaylists]);

  const handleDiscover = useCallback(() => {
    discoverScene(state.sceneConfig, state.scoringWeights);
  }, [state.sceneConfig, state.scoringWeights, discoverScene]);

  const handleMergeFetchTracks = useCallback(() => {
    fetchMergeTracks(state.myPlaylists, state.scoringWeights);
  }, [state.myPlaylists, state.scoringWeights, fetchMergeTracks]);

  const handleMergedTracksChange = useCallback(
    (tracks: ScoredTrack[]) => {
      dispatch({ type: "SET_MERGED_TRACKS", tracks });
    },
    [dispatch]
  );

  const handleModeChange = useCallback(
    (mode: DiscoveryMode) => {
      dispatch({ type: "SET_DISCOVERY_MODE", mode });
      dispatch({
        type: "SET_STEP",
        step:
          mode === "playlists"
            ? "search"
            : mode === "scene"
              ? "scene"
              : mode === "merge"
                ? "merge"
                : "download",
      });
    },
    [dispatch]
  );

  // --- Step indicators ---
  const playlistSteps: { key: WizardStep; label: string }[] = [
    { key: "search", label: "Search" },
    { key: "select", label: "Select" },
    { key: "preview", label: "Preview" },
    { key: "create", label: "Create" },
  ];

  const sceneSteps: { key: WizardStep; label: string }[] = [
    { key: "scene", label: "Discover" },
    { key: "preview", label: "Preview" },
    { key: "create", label: "Create" },
  ];

  const mergeSteps: { key: WizardStep; label: string }[] = [
    { key: "merge", label: "Select" },
    { key: "preview", label: "Preview" },
    { key: "create", label: "Create" },
  ];

  const steps =
    state.discoveryMode === "playlists"
      ? playlistSteps
      : state.discoveryMode === "scene"
        ? sceneSteps
        : mergeSteps;
  const currentStepIdx = steps.findIndex((s) => s.key === state.step);

  return (
    <div>
      {/* Mode toggle */}
      <div className="flex items-center gap-1 mb-6 bg-zinc-900 rounded-lg p-1 overflow-x-auto">
        {(
          [
            ["playlists", "Playlist Search"],
            ["scene", "Scene Discovery"],
            ["merge", "Merge Playlists"],
            ...(isAdmin ? [["download", "Download Track"] as const] : []),
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
              state.discoveryMode === mode
                ? "bg-orange-500 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Download mode is standalone — no wizard steps */}
      {state.discoveryMode === "download" && <DownloadStep />}

      {/* Step indicator (hidden for download mode) */}
      {state.discoveryMode !== "download" && (
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  i < currentStepIdx
                    ? "bg-orange-500 text-white"
                    : i === currentStepIdx
                      ? "bg-orange-500 text-white ring-2 ring-orange-500/30"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {i < currentStepIdx ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  i <= currentStepIdx ? "text-white" : "text-zinc-500"
                }`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`w-12 h-0.5 mx-1 transition-colors ${
                    i < currentStepIdx ? "bg-orange-500" : "bg-zinc-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step content with transition */}
      <AnimatePresence mode="wait">
      <motion.div
        key={state.step}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.15 }}
      >
      {state.step === "search" && (
        <SearchStep
          config={state.searchConfig}
          progress={state.searchProgress}
          playlistCount={state.playlists.length}
          onConfigChange={(config) =>
            dispatch({ type: "SET_SEARCH_CONFIG", config })
          }
          onSearch={search}
          onCancel={abortSearch}
          onNext={() => dispatch({ type: "SET_STEP", step: "select" })}
        />
      )}

      {state.step === "scene" && (
        <SceneStep
          config={state.sceneConfig}
          progress={state.sceneProgress}
          sceneUsers={state.sceneUsers}
          sceneEdges={state.sceneEdges}
          trackCount={state.tracks.length}
          onConfigChange={(config) =>
            dispatch({ type: "SET_SCENE_CONFIG", config })
          }
          onDiscover={handleDiscover}
          onCancel={abortScene}
          onBack={() => handleModeChange("playlists")}
          onNext={() => dispatch({ type: "SET_STEP", step: "preview" })}
          showGraph={plan === "unlimited" || role === "admin"}
          canMultiCity={plan !== "free" || role === "admin"}
        />
      )}

      {state.step === "merge" && (
        <MergeStep
          playlists={state.myPlaylists}
          progress={state.mergeProgress}
          trackCount={state.tracks.length}
          onLoadPlaylists={loadMyPlaylists}
          onToggle={(id) => dispatch({ type: "TOGGLE_MY_PLAYLIST", id })}
          onSelectAll={(selected) =>
            dispatch({ type: "SELECT_ALL_MY_PLAYLISTS", selected })
          }
          onAddPlaylist={(playlist) =>
            dispatch({ type: "ADD_MY_PLAYLIST", playlist })
          }
          onFetchTracks={handleMergeFetchTracks}
          onCancel={abortMerge}
          onNext={() => dispatch({ type: "SET_STEP", step: "preview" })}
          canAddExternal={plan !== "free" || role === "admin"}
        />
      )}

      {state.step === "select" && (
        <SelectStep
          playlists={state.playlists}
          trackFetchProgress={state.trackFetchProgress}
          onToggle={(id) => dispatch({ type: "TOGGLE_PLAYLIST", id })}
          onSelectAll={(selected) =>
            dispatch({ type: "SELECT_ALL_PLAYLISTS", selected })
          }
          onFetchTracks={handleFetchTracks}
          onBack={() => dispatch({ type: "SET_STEP", step: "search" })}
          onNext={() => dispatch({ type: "SET_STEP", step: "preview" })}
          trackCount={state.tracks.length}
        />
      )}

      {state.step === "preview" && (
        <PreviewStep
          tracks={state.tracks}
          mergedTracks={state.mergedTracks}
          weights={state.scoringWeights}
          maxTracks={state.maxTracksToRetain}
          onWeightsChange={(weights) =>
            dispatch({ type: "SET_SCORING_WEIGHTS", weights })
          }
          onMaxTracksChange={(max) =>
            dispatch({ type: "SET_MAX_TRACKS", max })
          }
          onMergedTracksChange={handleMergedTracksChange}
          onBack={() =>
            dispatch({
              type: "SET_STEP",
              step:
                state.discoveryMode === "playlists"
                  ? "select"
                  : state.discoveryMode === "scene"
                    ? "scene"
                    : "merge",
            })
          }
          onNext={() => dispatch({ type: "SET_STEP", step: "create" })}
          isAdmin={isAdmin}
          canRemoveTracks={plan !== "free" || role === "admin"}
          canCustomizeColumns={plan !== "free" || role === "admin"}
        />
      )}

      {state.step === "create" && (
        <CreateStep
          outputTitle={state.outputTitle}
          outputSharing={state.outputSharing}
          trackCount={state.mergedTracks.length}
          progress={state.creationProgress}
          createdPlaylists={state.createdPlaylists}
          onTitleChange={(title) =>
            dispatch({ type: "SET_OUTPUT_TITLE", title })
          }
          onSharingChange={(sharing) =>
            dispatch({ type: "SET_OUTPUT_SHARING", sharing })
          }
          onCreate={handleCreate}
          onBack={() => dispatch({ type: "SET_STEP", step: "preview" })}
          onReset={() => dispatch({ type: "RESET" })}
          removeBranding={planConfig.removeBranding}
        />
      )}
      </motion.div>
      </AnimatePresence>
    </div>
  );
}
