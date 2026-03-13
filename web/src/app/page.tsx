import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();

  if (session.tokens) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <main className="max-w-2xl mx-auto px-6 text-center space-y-8">
        <img
          src="/cratemine_logo.png"
          alt="CrateMine"
          className="h-[560px] mx-auto"
        />
        <p className="text-xl text-zinc-400 leading-relaxed">
          Search SoundCloud for playlists, merge their tracks, deduplicate,
          score by popularity, and create a new mega playlist on your account.
        </p>

        <div className="space-y-4">
          <a
            href="/api/auth/login"
            className="inline-block px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white text-lg font-medium rounded-lg transition-colors"
          >
            Connect with SoundCloud
          </a>
          <p className="text-sm text-zinc-600">
            We only access your playlists. You can disconnect at any time.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6 pt-8 border-t border-zinc-800">
          <div>
            <p className="text-3xl font-bold text-orange-500">1</p>
            <p className="text-sm text-zinc-400 mt-1">
              Search for playlists by genre, keywords, or tags
            </p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500">2</p>
            <p className="text-sm text-zinc-400 mt-1">
              Preview merged tracks sorted by plays, likes, and reposts
            </p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500">3</p>
            <p className="text-sm text-zinc-400 mt-1">
              Create a playlist on your SoundCloud account in one click
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
