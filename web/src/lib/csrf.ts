import { NextRequest, NextResponse } from "next/server";

/**
 * Verify that a request originates from our own domain.
 * Returns null if valid, or a 403 response if CSRF detected.
 *
 * Requires the Origin header to be present on all POST requests.
 * Falls back to Referer only if Origin is missing (non-browser clients).
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return validateOrigin(origin);
  }

  // No Origin — check Referer as fallback
  const referer = request.headers.get("referer");
  if (referer) {
    return validateOrigin(referer);
  }

  // No Origin or Referer — reject for state-changing requests
  // Modern browsers always send Origin on cross-origin POST requests,
  // so a missing Origin likely means a non-browser or stripped request
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function validateOrigin(originOrReferer: string): NextResponse | null {
  try {
    const parsed = new URL(originOrReferer);
    const expected =
      process.env.NEXTAUTH_URL ||
      process.env.AUTH_URL ||
      "http://localhost:3000";
    const expectedHost = new URL(expected).host;
    if (parsed.host === expectedHost) {
      return null;
    }
  } catch {
    // Invalid URL
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
