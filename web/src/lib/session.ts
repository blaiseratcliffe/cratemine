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

const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    "SESSION_SECRET or AUTH_SECRET environment variable must be set (min 32 chars)"
  );
}

const sessionOptions: SessionOptions = {
  password: secret,
  cookieName: "cratemine_sc_link",
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
