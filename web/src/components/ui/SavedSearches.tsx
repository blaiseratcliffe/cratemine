"use client";

import { useCallback, useEffect, useState } from "react";

interface SavedSearch {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  createdAt: string;
}

interface Props {
  type: "playlist_search" | "scene_discovery";
  currentConfig: Record<string, unknown>;
  onLoad: (config: Record<string, unknown>) => void;
}

export function SavedSearches({ type, currentConfig, onLoad }: Props) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [limit, setLimit] = useState(0);
  const [count, setCount] = useState(0);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchSearches = useCallback(async () => {
    try {
      const res = await fetch("/api/saved-searches");
      if (!res.ok) return;
      const data = await res.json();
      setSearches(
        (data.searches || []).filter((s: SavedSearch) => s.type === type)
      );
      setLimit(data.limit);
      setCount(data.count);
    } catch {
      // ignore
    }
  }, [type]);

  useEffect(() => {
    if (!loaded) {
      setLoaded(true);
      fetchSearches();
    }
  }, [loaded, fetchSearches]);

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), type, config: currentConfig }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      setSaveName("");
      setShowSave(false);
      fetchSearches();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      fetchSearches();
    } catch {
      // ignore
    }
  }

  // limit: -1 = unlimited, 0 = none (free), >0 = capped
  const isUnlimited = limit === -1;
  const atLimit = !isUnlimited && limit > 0 && count >= limit;
  const isFreePlan = limit === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Saved search pills */}
        {searches.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-1 bg-zinc-800 rounded-lg pl-3 pr-1 py-1 text-sm"
          >
            <button
              onClick={() => onLoad(s.config)}
              className="text-zinc-300 hover:text-orange-400 transition-colors cursor-pointer"
              title={`Load "${s.name}"`}
            >
              {s.name}
            </button>
            <button
              onClick={() => handleDelete(s.id)}
              className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer p-1"
              title="Delete"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Save button */}
        {!isFreePlan && !showSave && (
          <button
            onClick={() => {
              if (atLimit) {
                setError(`Limit reached (${limit}). Upgrade for more.`);
              } else {
                setShowSave(true);
                setError("");
              }
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-orange-400 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Save search
            {limit > 0 && (
              <span className="text-zinc-600">
                ({searches.length}/{limit})
              </span>
            )}
          </button>
        )}

        {/* Save input */}
        {showSave && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Name this search..."
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none w-40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowSave(false);
              }}
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim() || saving}
              className="text-xs px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? "..." : "Save"}
            </button>
            <button
              onClick={() => setShowSave(false)}
              className="text-xs text-zinc-500 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
