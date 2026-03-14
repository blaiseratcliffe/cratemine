"use client";

export function ProgressBar({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label?: string;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-zinc-400">{label}</p>
          <p className="text-xs text-zinc-500 font-mono">
            {completed}/{total} ({pct}%)
          </p>
        </div>
      )}
      <div
        className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || "Progress"}
      >
        <div
          className="bg-orange-500 h-2 rounded-full transition-all duration-300 relative overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          {pct > 0 && pct < 100 && (
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ animation: "shimmer 1.5s infinite" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
