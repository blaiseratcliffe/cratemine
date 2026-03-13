import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SCTokens } from "@/lib/soundcloud/types";
import { tokensAreValid, refreshAccessToken } from "@/lib/soundcloud/oauth";

export interface SessionData {
  tokens?: SCTokens;
  pkceVerifier?: string;
  oauthState?: string;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "cratemine_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Get a valid access token from the session, refreshing if needed.
 * Returns null if no session or refresh fails.
 */
export async function getValidToken(): Promise<string | null> {
  const session = await getSession();
  if (!session.tokens) return null;

  if (tokensAreValid(session.tokens)) {
    return session.tokens.access_token;
  }

  // Try to refresh
  try {
    const newTokens = await refreshAccessToken({
      refreshToken: session.tokens.refresh_token,
      clientId: process.env.SC_CLIENT_ID!,
      clientSecret: process.env.SC_CLIENT_SECRET!,
    });
    session.tokens = newTokens;
    await session.save();
    return newTokens.access_token;
  } catch {
    // Refresh failed — clear session
    session.destroy();
    return null;
  }
}
