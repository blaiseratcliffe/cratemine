"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Spinner } from "@/components/ui/Spinner";

interface User {
  id: number;
  username: string;
  avatar_url: string;
  permalink_url: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  city?: string | null;
  country_code?: string | null;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  playlist_count?: number;
  description?: string | null;
  created_at?: string;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-3 border-b border-zinc-800 last:border-b-0">
      <span className="text-sm text-zinc-500 w-40 shrink-0">{label}</span>
      <span className="text-sm text-white">{value ?? "—"}</span>
    </div>
  );
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error("Not authenticated");
        return r.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => router.push("/"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await signOut({ redirectTo: "/" });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  const displayName =
    user.full_name ||
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username;

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to dashboard
          </button>
          <button
            onClick={handleLogout}
            className="text-sm text-zinc-500 hover:text-white transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Profile header */}
        <div className="flex items-center gap-5 mb-8">
          {user.avatar_url && (
            <img
              src={user.avatar_url}
              alt=""
              className="w-20 h-20 rounded-full border-2 border-zinc-700"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold text-white">{displayName}</h1>
            <p className="text-sm text-zinc-400">@{user.username}</p>
          </div>
        </div>

        {/* Account details */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 mb-6">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="text-base font-medium text-white">
              Account details
            </h2>
          </div>
          <div className="px-5 py-1">
            <InfoRow label="Username" value={user.username} />
            <InfoRow label="Display name" value={displayName} />
            <InfoRow
              label="SoundCloud ID"
              value={
                <span className="font-mono text-zinc-300">{user.id}</span>
              }
            />
            <InfoRow
              label="Profile URL"
              value={
                <a
                  href={user.permalink_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 transition-colors"
                >
                  {user.permalink_url}
                </a>
              }
            />
            <InfoRow label="Member since" value={memberSince} />
          </div>
        </section>

        {/* Location */}
        {(user.city || user.country_code) && (
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 mb-6">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-base font-medium text-white">Location</h2>
            </div>
            <div className="px-5 py-1">
              {user.city && <InfoRow label="City" value={user.city} />}
              {user.country_code && (
                <InfoRow label="Country" value={user.country_code} />
              )}
            </div>
          </section>
        )}

        {/* Stats */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 mb-6">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="text-base font-medium text-white">
              SoundCloud stats
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-5 py-5">
            <StatCard label="Followers" value={user.followers_count} />
            <StatCard label="Following" value={user.followings_count} />
            <StatCard label="Tracks" value={user.track_count} />
            <StatCard label="Playlists" value={user.playlist_count} />
          </div>
        </section>

        {/* Bio */}
        {user.description && (
          <section className="bg-zinc-900 rounded-lg border border-zinc-800 mb-6">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-base font-medium text-white">Bio</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                {user.description}
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value?: number | null;
}) {
  return (
    <div className="text-center">
      <p className="text-2xl font-semibold text-white font-mono">
        {value != null ? value.toLocaleString() : "—"}
      </p>
      <p className="text-xs text-zinc-500 mt-1">{label}</p>
    </div>
  );
}
