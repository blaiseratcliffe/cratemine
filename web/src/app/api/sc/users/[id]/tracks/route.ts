import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUserTracksResponse } from "@/lib/soundcloud/types";

/**
 * Fetch a user's tracks. Single page (200 max) for speed.
 * SoundCloud returns newest first, so one page captures recent tracks.
 *
 * Optional query param:
 *   ?since=2025-12-13T00:00:00Z — only return tracks created after this date
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getValidSCToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const query: Record<string, string> = {
    limit: "200",
    linked_partitioning: "true",
  };

  // Optional date filter
  const since = request.nextUrl.searchParams.get("since");
  if (since) {
    query["created_at[from]"] = since;
  }

  const res = await scReq<SCUserTracksResponse>(
    "GET",
    `/users/${id}/tracks`,
    token,
    { query }
  );

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `Failed to fetch user tracks (${res.status})` },
      { status: res.status || 500 }
    );
  }

  // Client-side date filter as safety net (SoundCloud may not always respect the param)
  let tracks = res.json.collection || [];
  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      tracks = tracks.filter((t) => new Date(t.created_at).getTime() >= sinceMs);
    }
  }

  return NextResponse.json({ tracks });
}
