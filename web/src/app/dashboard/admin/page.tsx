"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Spinner } from "@/components/ui/Spinner";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  plan: string;
  createdAt: string;
  soundcloudAccount: {
    scUsername: string;
    scUserId: number;
  } | null;
}

export default function AdminPage() {
  const { data: session, status, update: updateSession } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [switchingPlan, setSwitchingPlan] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
      return;
    }
    if (status === "authenticated") {
      loadUsers();
    }
  }, [status, router]);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        router.push("/dashboard");
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data.users);
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function changeUserPlan(userId: string, plan: string) {
    setUpdating(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, plan } : u))
      );
    } catch {
      alert("Failed to update plan");
    } finally {
      setUpdating(null);
    }
  }

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === "admin" ? "user" : "admin";
    setUpdating(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch {
      alert("Failed to update role");
    } finally {
      setUpdating(null);
    }
  }

  const myUser = users.find((u) => u.id === session?.user?.id);
  const myPlan = myUser?.plan || "unlimited";

  async function switchTestPlan(plan: string) {
    if (!session?.user?.id) return;
    setSwitchingPlan(plan);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: session.user.id, plan }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) => (u.id === session.user.id ? { ...u, plan } : u))
      );
      // Refresh the Auth.js session so plan propagates everywhere
      await updateSession();
    } catch {
      alert("Failed to switch plan");
    } finally {
      setSwitchingPlan(null);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
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
          <span className="text-sm text-orange-400 font-medium">Admin</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Test mode */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-white">Test as different plan</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Switches your actual plan for full-stack testing. Remember to switch back.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(["free", "pro", "unlimited"] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => switchTestPlan(plan)}
                  disabled={myPlan === plan || !!switchingPlan}
                  className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer capitalize ${
                    myPlan === plan
                      ? "bg-orange-500 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                  } disabled:cursor-default disabled:opacity-70`}
                >
                  {switchingPlan === plan ? "..." : plan}
                </button>
              ))}
            </div>
          </div>
          {myPlan !== "unlimited" && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              Currently testing as <span className="font-medium capitalize">{myPlan}</span> — features are restricted
            </div>
          )}
        </div>

        <h1 className="text-2xl font-semibold text-white mb-6">
          User Management
        </h1>

        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900">
              <tr>
                <th className="p-3 text-left text-zinc-400">User</th>
                <th className="p-3 text-left text-zinc-400">Email</th>
                <th className="p-3 text-left text-zinc-400">SoundCloud</th>
                <th className="p-3 text-left text-zinc-400">Joined</th>
                <th className="p-3 text-center text-zinc-400">Plan</th>
                <th className="p-3 text-center text-zinc-400">Role</th>
                <th className="p-3 text-center text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-zinc-800">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {u.image && (
                        <img
                          src={u.image}
                          alt=""
                          className="w-6 h-6 rounded-full"
                        />
                      )}
                      <span className="text-white">
                        {u.name || "Unnamed"}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-zinc-400">{u.email || "—"}</td>
                  <td className="p-3 text-zinc-400">
                    {u.soundcloudAccount ? (
                      <span>
                        {u.soundcloudAccount.scUsername}
                        <span className="text-zinc-600 text-xs ml-1">
                          #{u.soundcloudAccount.scUserId}
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-600">Not linked</span>
                    )}
                  </td>
                  <td className="p-3 text-zinc-500 text-xs whitespace-nowrap">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-center">
                    <select
                      value={u.plan}
                      onChange={(e) => changeUserPlan(u.id, e.target.value)}
                      disabled={updating === u.id}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 cursor-pointer focus:border-orange-500 focus:outline-none capitalize"
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="unlimited">Unlimited</option>
                    </select>
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-orange-500/20 text-orange-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {u.id === session?.user?.id ? (
                      <span className="text-xs text-zinc-600">You</span>
                    ) : (
                      <button
                        onClick={() => toggleRole(u.id, u.role)}
                        disabled={updating === u.id}
                        className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {updating === u.id
                          ? "..."
                          : u.role === "admin"
                            ? "Demote"
                            : "Make admin"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-zinc-600 mt-4">
          Admins can download tracks. Regular users can search, discover, merge,
          and create playlists.
        </p>
      </main>
    </div>
  );
}
