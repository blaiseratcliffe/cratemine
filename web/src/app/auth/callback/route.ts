import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exchangeCodeForTokens } from "@/lib/soundcloud/oauth";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?error=missing_params", request.url));
  }

  const session = await getSession();

  if (state !== session.oauthState) {
    return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
  }

  if (!session.pkceVerifier) {
    return NextResponse.redirect(
      new URL("/?error=missing_verifier", request.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: session.pkceVerifier,
      clientId: process.env.SC_CLIENT_ID!,
      clientSecret: process.env.SC_CLIENT_SECRET!,
      redirectUri: process.env.SC_REDIRECT_URI!,
    });

    session.tokens = tokens;
    session.pkceVerifier = undefined;
    session.oauthState = undefined;
    await session.save();

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
