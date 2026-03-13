import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  generatePKCE,
  generateState,
  buildAuthorizeUrl,
} from "@/lib/soundcloud/oauth";

export async function GET() {
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

  return NextResponse.redirect(url);
}
