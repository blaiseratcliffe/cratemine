"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { WizardShell } from "@/components/wizard/WizardShell";
import { UserMenu } from "@/components/ui/UserMenu";
import { Spinner } from "@/components/ui/Spinner";

interface SCStatus {
  linked: boolean;
  soundcloud: {
    scUserId: number;
    scUsername: string;
    scAvatarUrl: string | null;
  } | null;
  role: string;
  plan: string;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [scStatus, setScStatus] = useState<SCStatus | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
      return;
    }
    if (status === "authenticated") {
      fetch("/api/auth/soundcloud/status")
        .then((r) => r.json())
        .then((data) => {
          if (!data.linked) {
            router.push("/link-soundcloud");
          } else {
            setScStatus(data);
          }
        })
        .catch(() => router.push("/"));
    }
  }, [status, router]);

  async function handleLogout() {
    await signOut({ redirectTo: "/" });
  }

  if (status === "loading" || !scStatus) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const user = {
    id: scStatus.soundcloud?.scUserId ?? 0,
    username: scStatus.soundcloud?.scUsername ?? "",
    avatar_url: scStatus.soundcloud?.scAvatarUrl ?? "",
    permalink_url: "",
    authName: session?.user?.name ?? undefined,
    authEmail: session?.user?.email ?? undefined,
    authImage: session?.user?.image ?? undefined,
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <img src="/cratemine_logo.png" alt="CrateMine" className="h-9" />
          <UserMenu user={user} isAdmin={scStatus.role === "admin"} onLogout={handleLogout} />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <WizardShell isAdmin={scStatus.role === "admin"} plan={scStatus.plan} role={scStatus.role} />
      </main>
    </div>
  );
}
