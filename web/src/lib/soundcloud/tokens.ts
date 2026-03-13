import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tokensAreValid, refreshAccessToken } from "@/lib/soundcloud/oauth";
import type { SCTokens } from "@/lib/soundcloud/types";

// In-memory refresh lock to prevent concurrent refresh races
const refreshLocks = new Map<string, Promise<string | null>>();

/**
 * Get a valid SC access token for the current Auth.js user.
 * Reads from DB, refreshes if expired, updates DB on refresh.
 * Returns null if user not logged in or SC not linked.
 */
export async function getValidSCToken(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const sc = await prisma.soundCloudAccount.findUnique({
    where: { userId: session.user.id },
  });
  if (!sc) return null;

  const tokens: SCTokens = {
    access_token: sc.accessToken,
    refresh_token: sc.refreshToken,
    expires_in: sc.expiresIn,
    created_at: sc.createdAt,
  };

  if (tokensAreValid(tokens)) {
    return tokens.access_token;
  }

  // Use a per-user lock to prevent concurrent refresh attempts
  const userId = session.user.id;
  const existing = refreshLocks.get(userId);
  if (existing) {
    return existing;
  }

  const refreshPromise = doRefresh(userId, tokens);
  refreshLocks.set(userId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(userId);
  }
}

async function doRefresh(
  userId: string,
  tokens: SCTokens
): Promise<string | null> {
  try {
    const newTokens = await refreshAccessToken({
      refreshToken: tokens.refresh_token,
      clientId: process.env.SC_CLIENT_ID!,
      clientSecret: process.env.SC_CLIENT_SECRET!,
    });

    // Optimistic update: only update if the refresh token hasn't changed
    // (another instance may have refreshed it already)
    await prisma.soundCloudAccount.updateMany({
      where: {
        userId,
        refreshToken: tokens.refresh_token, // only if token hasn't been rotated
      },
      data: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresIn: newTokens.expires_in,
        createdAt: newTokens.created_at,
      },
    });

    return newTokens.access_token;
  } catch {
    // Refresh failed — re-read from DB in case another instance refreshed it
    const fresh = await prisma.soundCloudAccount.findUnique({
      where: { userId },
    });
    if (fresh && fresh.refreshToken !== tokens.refresh_token) {
      // Another instance already refreshed — use the new token
      return fresh.accessToken;
    }
    // Genuinely expired — don't delete, let user re-link
    console.error(`[tokens] SC token refresh failed for user ${userId}`);
    return null;
  }
}
