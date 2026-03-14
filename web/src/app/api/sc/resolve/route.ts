import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";

interface ResolvedEntity {
  kind?: string;
  id: number;
  title?: string;
  username?: string;
  [key: string]: unknown;
}

/**
 * Resolve a SoundCloud URL to an API object (track, user, or playlist).
 * POST body: { url: string }
 */
export async function POST(request: NextRequest) {
  const token = await getValidSCToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { url } = await request.json();

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const res = await scReq<ResolvedEntity>("GET", "/resolve", token, {
    query: { url },
  });

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: "Resolve failed" },
      { status: res.status || 500 }
    );
  }

  // Return under the appropriate key based on kind, plus raw resolved object
  const entity = res.json;
  return NextResponse.json({
    kind: entity.kind || "unknown",
    resolved: entity,
    // Keep backward compat for scene discovery which expects { user: ... }
    ...(entity.kind === "user" ? { user: entity } : {}),
    ...(entity.kind === "track" ? { track: entity } : {}),
  });
}
