import { NextRequest, NextResponse } from "next/server";

/**
 * Verify that a request originates from our own domain.
 * Returns null if valid, or a 403 response if CSRF detected.
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — could be same-origin or server-side
    // Check Referer as fallback
    const referer = request.headers.get("referer");
    if (referer) {
      return validateOrigin(referer);
    }
    // No Origin or Referer — allow (same-origin requests may omit both)
    return null;
  }
  return validateOrigin(origin);
}

function validateOrigin(originOrReferer: string): NextResponse | null {
  try {
    const parsed = new URL(originOrReferer);
    const expected = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
    const expectedHost = new URL(expected).host;
    if (parsed.host === expectedHost) {
      return null;
    }
  } catch {
    // Invalid URL
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
