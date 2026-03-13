import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCPlaylist } from "@/lib/soundcloud/types";

interface PlaylistsPage {
  collection: SCPlaylist[];
  next_href: string | null;
}

/**
 * Fetch the authenticated user's playlists, following pagination.
 * Supports cursor-based pagination via ?cursor query param.
 */
export async function GET(request: NextRequest) {
  const token = await getValidSCToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cursor = request.nextUrl.searchParams.get("cursor");
  const url = cursor || "/me/playlists";
  const query = cursor
    ? undefined
    : { limit: "200", linked_partitioning: "true" };

  const res = await scReq<PlaylistsPage>("GET", url, token, { query });

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `Failed to fetch playlists (${res.status})` },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({
    playlists: res.json.collection || [],
    nextCursor: res.json.next_href || null,
  });
}
