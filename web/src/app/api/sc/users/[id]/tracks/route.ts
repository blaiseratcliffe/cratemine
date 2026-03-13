import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/session";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUserTracksResponse } from "@/lib/soundcloud/types";

/**
 * Fetch a user's tracks. Single page (200 max) for speed.
 * SoundCloud returns newest first, so one page captures recent tracks.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const res = await scReq<SCUserTracksResponse>(
    "GET",
    `/users/${id}/tracks`,
    token,
    {
      query: {
        limit: "200",
        linked_partitioning: "true",
      },
    }
  );

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `Failed to fetch user tracks (${res.status})` },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({ tracks: res.json.collection || [] });
}
