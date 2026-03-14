import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LinkSoundCloudButton } from "@/components/LinkSoundCloudButton";

export default async function LinkSoundCloudPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  // Already linked? Go to dashboard
  const sc = await prisma.soundCloudAccount.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (sc) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <main className="max-w-md mx-auto px-6 text-center space-y-8">
        <img
          src="/cratemine_logo.png"
          alt="CrateMine"
          className="h-40 mx-auto"
        />

        <div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Link SoundCloud
          </h1>
          <p className="text-zinc-400">
            Connect your SoundCloud account to search playlists, discover
            scenes, and create new playlists.
          </p>
        </div>

        <div className="bg-zinc-900 rounded-lg p-4 text-left">
          <p className="text-sm text-zinc-400 mb-1">Signed in as</p>
          <div className="flex items-center gap-3">
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full"
              />
            )}
            <div>
              <p className="text-white text-sm font-medium">
                {session.user.name}
              </p>
              <p className="text-zinc-500 text-xs">{session.user.email}</p>
            </div>
          </div>
        </div>

        <LinkSoundCloudButton />

        <p className="text-sm text-zinc-500">
          We only access your playlists. You can disconnect at any time.
        </p>
      </main>
    </div>
  );
}
