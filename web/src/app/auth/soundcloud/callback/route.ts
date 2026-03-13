import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { exchangeCodeForTokens } from "@/lib/soundcloud/oauth";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUser } from "@/lib/soundcloud/types";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function redirectUrl(path: string): string {
  const origin = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
  return `${origin}${path}`;
}

/**
 * SoundCloud OAuth callback — exchanges code for tokens and
 * saves the linked SC account to the database.
 */
export async function GET(request: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.redirect(redirectUrl("/?error=not_authenticated"));
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Read and immediately clear PKCE data regardless of outcome
  const session = await getSession();
  const verifier = session.pkceVerifier;
  const expectedState = session.oauthState;
  session.pkceVerifier = undefined;
  session.oauthState = undefined;
  await session.save();

  if (error) {
    return NextResponse.redirect(redirectUrl("/link-soundcloud?error=sc_denied"));
  }

  if (!code || !state) {
    return NextResponse.redirect(redirectUrl("/link-soundcloud?error=missing_params"));
  }

  if (!expectedState || !safeCompare(state, expectedState)) {
    return NextResponse.redirect(redirectUrl("/link-soundcloud?error=invalid_state"));
  }

  if (!verifier) {
    return NextResponse.redirect(redirectUrl("/link-soundcloud?error=missing_verifier"));
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      clientId: process.env.SC_CLIENT_ID!,
      clientSecret: process.env.SC_CLIENT_SECRET!,
      redirectUri: process.env.SC_REDIRECT_URI!,
    });

    // Fetch SC user info
    const userRes = await scReq<SCUser>("GET", "/me", tokens.access_token);
    if (userRes.status !== 200 || !userRes.json) {
      console.error(`[sc-callback] Failed to fetch SC user: ${userRes.status}`);
      return NextResponse.redirect(redirectUrl("/link-soundcloud?error=sc_fetch_failed"));
    }

    const scUser = userRes.json;

    // Upsert the SoundCloud account link
    await prisma.soundCloudAccount.upsert({
      where: { userId: authSession.user.id },
      create: {
        userId: authSession.user.id,
        scUserId: scUser.id,
        scUsername: scUser.username,
        scAvatarUrl: scUser.avatar_url,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        createdAt: tokens.created_at,
      },
      update: {
        scUserId: scUser.id,
        scUsername: scUser.username,
        scAvatarUrl: scUser.avatar_url,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        createdAt: tokens.created_at,
      },
    });

    return NextResponse.redirect(redirectUrl("/dashboard"));
  } catch (err) {
    console.error(`[sc-callback] Token exchange error:`, err);
    return NextResponse.redirect(redirectUrl("/link-soundcloud?error=exchange_failed"));
  }
}
