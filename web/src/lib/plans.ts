export type Plan = "free" | "pro" | "unlimited";

export interface PlanConfig {
  name: string;
  price: number; // monthly USD
  maxPlaylistsPerDay: number; // 0 = unlimited
  maxTracksPerRun: number; // 0 = unlimited
  maxSeeds: number; // 0 = unlimited
  maxSavedSearches: number; // 0 = unlimited
  maxPlaylistSearchesPerDay: number; // 0 = unlimited
  maxSceneDiscoveriesPerDay: number; // 0 = unlimited
  removeBranding: boolean;
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: {
    name: "Free",
    price: 0,
    maxPlaylistsPerDay: 1,
    maxTracksPerRun: 500,
    maxSeeds: 10,
    maxSavedSearches: 0,
    maxPlaylistSearchesPerDay: 3,
    maxSceneDiscoveriesPerDay: 2,
    removeBranding: false,
  },
  pro: {
    name: "Pro",
    price: 4,
    maxPlaylistsPerDay: 5,
    maxTracksPerRun: 2000,
    maxSeeds: 0,
    maxSavedSearches: 2,
    maxPlaylistSearchesPerDay: 25,
    maxSceneDiscoveriesPerDay: 15,
    removeBranding: true,
  },
  unlimited: {
    name: "Unlimited",
    price: 6,
    maxPlaylistsPerDay: 0,
    maxTracksPerRun: 0,
    maxSeeds: 0,
    maxSavedSearches: 25,
    maxPlaylistSearchesPerDay: 0,
    maxSceneDiscoveriesPerDay: 0,
    removeBranding: true,
  },
};

/**
 * Get effective plan for a user based on their plan and role.
 * Admins get unlimited everything.
 */
export function getEffectivePlan(plan: string, role: string): PlanConfig {
  if (role === "admin") {
    return { ...PLANS.unlimited, maxSavedSearches: 0 }; // 0 = unlimited for admin
  }
  return PLANS[plan as Plan] ?? PLANS.free;
}
