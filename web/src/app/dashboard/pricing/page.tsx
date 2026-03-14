"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Spinner } from "@/components/ui/Spinner";

interface PriceIds {
  pro: string | null;
  unlimited: string | null;
}

interface PlanCard {
  plan: string;
  name: string;
  price: string;
  priceKey: "pro" | "unlimited" | null;
  features: string[];
  highlighted?: boolean;
}

const PLANS: PlanCard[] = [
  {
    plan: "free",
    name: "Free",
    price: "$0",
    priceKey: null,
    features: [
      "Playlist search & merge",
      "Scene discovery (10 seeds)",
      "1 playlist per day",
      "500 tracks per run",
      "CrateMine branding",
    ],
  },
  {
    plan: "pro",
    name: "Pro",
    price: "$4/mo",
    priceKey: "pro",
    features: [
      "Everything in Free",
      "Full scene discovery",
      "5 playlists per day",
      "2,000 tracks per run",
      "No branding",
    ],
    highlighted: true,
  },
  {
    plan: "unlimited",
    name: "Unlimited",
    price: "$6/mo",
    priceKey: "unlimited",
    features: [
      "Everything in Pro",
      "Unlimited playlists per day",
      "Unlimited tracks per run",
      "Priority support",
    ],
  },
];

export default function PricingPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState<string | null>(null);
  const [priceIds, setPriceIds] = useState<PriceIds | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/stripe/prices")
      .then((r) => r.json())
      .then((data) => setPriceIds(data))
      .catch(() => {});
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const currentPlan = (session?.user as { plan?: string })?.plan || "free";

  async function handleUpgrade(priceId: string) {
    setLoading(priceId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      alert("Failed to start checkout. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleManage() {
    setLoading("manage");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      alert("Failed to open billing portal.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to dashboard
          </button>
          {currentPlan !== "free" && (
            <button
              onClick={handleManage}
              disabled={loading === "manage"}
              className="text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              {loading === "manage" ? "Loading..." : "Manage subscription"}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white">Choose your plan</h1>
          <p className="text-zinc-400 mt-2">
            Upgrade to unlock more features and higher limits.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {PLANS.map((p) => {
            const isCurrent = p.plan === currentPlan;
            const priceId = p.priceKey && priceIds ? priceIds[p.priceKey] : null;

            return (
              <div
                key={p.plan}
                className={`rounded-xl p-6 border ${
                  p.highlighted
                    ? "border-orange-500 bg-zinc-900"
                    : "border-zinc-800 bg-zinc-900/50"
                }`}
              >
                {p.highlighted && (
                  <span className="text-xs font-medium text-orange-400 uppercase tracking-wide">
                    Most popular
                  </span>
                )}
                <h2 className="text-xl font-semibold text-white mt-1">
                  {p.name}
                </h2>
                <p className="text-3xl font-bold text-white mt-2">
                  {p.price}
                </p>

                <ul className="mt-6 space-y-3">
                  {p.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm text-zinc-300"
                    >
                      <svg
                        className="w-4 h-4 text-orange-500 mt-0.5 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {isCurrent ? (
                    <div className="w-full py-2 text-center text-sm text-zinc-500 border border-zinc-700 rounded-lg">
                      Current plan
                    </div>
                  ) : priceId ? (
                    <button
                      onClick={() => handleUpgrade(priceId)}
                      disabled={!!loading}
                      className={`w-full py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                        p.highlighted
                          ? "bg-orange-500 hover:bg-orange-600 text-white"
                          : "bg-zinc-800 hover:bg-zinc-700 text-white"
                      } disabled:opacity-50`}
                    >
                      {loading === priceId ? "Loading..." : "Upgrade"}
                    </button>
                  ) : p.priceKey ? (
                    <div className="w-full py-2 text-center text-sm text-zinc-600">
                      Loading...
                    </div>
                  ) : (
                    <div className="w-full py-2 text-center text-sm text-zinc-600">
                      Free forever
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
