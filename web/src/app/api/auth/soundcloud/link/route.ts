import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import {
  generatePKCE,
  generateState,
  buildAuthorizeUrl,
} from "@/lib/soundcloud/oauth";

/**
 * Initiates SoundCloud OAuth PKCE flow.
 * Requires the user to be logged in via Auth.js.
 * Returns the authorization URL for client-side redirect.
 */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  const session = await getSession();
  session.pkceVerifier = verifier;
  session.oauthState = state;
  await session.save();

  const url = buildAuthorizeUrl({
    clientId: process.env.SC_CLIENT_ID!,
    redirectUri: process.env.SC_REDIRECT_URI!,
    challenge,
    state,
  });

  return NextResponse.json({ url });
}
