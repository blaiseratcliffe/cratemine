import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignInButtons } from "@/components/SignInButtons";

export default async function Home() {
  const session = await auth();

  if (session?.user?.id) {
    // Check if SC is linked
    const sc = await prisma.soundCloudAccount.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (sc) {
      redirect("/dashboard");
    } else {
      redirect("/link-soundcloud");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <main className="max-w-2xl mx-auto px-6 text-center space-y-8">
        <img
          src="/cratemine_logo.png"
          alt="CrateMine"
          className="h-[370px] mx-auto"
        />

        <div className="grid grid-cols-3 gap-6 pb-8 border-b border-zinc-800">
          <div>
            <p className="text-3xl font-bold text-orange-500">1</p>
            <p className="text-sm text-zinc-400 mt-1">
              Search, discover, or merge playlists from SoundCloud
            </p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500">2</p>
            <p className="text-sm text-zinc-400 mt-1">
              Deduplicate, score, sort, and preview tracks
            </p>
          </div>
          <div>
            <p className="text-3xl font-bold text-orange-500">3</p>
            <p className="text-sm text-zinc-400 mt-1">
              Create playlists or download tracks in one click
            </p>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Sign In</h1>
          <p className="text-zinc-400">Choose your preferred method.</p>
        </div>

        <SignInButtons />

        <p className="text-sm text-zinc-600">
          After signing in, you&apos;ll link your SoundCloud account.
        </p>
      </main>
    </div>
  );
}
