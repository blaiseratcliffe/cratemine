import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

/**
 * Minimal session — only used for SoundCloud PKCE handshake.
 * Auth.js handles user sessions; SC tokens live in the database.
 */
export interface SessionData {
  pkceVerifier?: string;
  oauthState?: string;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET or AUTH_SECRET environment variable must be set (min 32 chars)"
    );
  }
  return secret;
}

export async function getSession() {
  const sessionOptions: SessionOptions = {
    password: getSecret(),
    cookieName: "cratemine_sc_link",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  };

  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
