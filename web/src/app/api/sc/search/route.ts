import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import { verifyCsrf } from "@/lib/csrf";
import type { SCSearchResponse } from "@/lib/soundcloud/types";

/**
 * Search SoundCloud playlists. Handles one query term at a time.
 * POST body: { query: string, cursor?: string }
 * Returns: { playlists: SCPlaylist[], nextCursor: string | null }
 */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const token = await getValidSCToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { query, cursor } = await request.json();

  if (!query && !cursor) {
    return NextResponse.json(
      { error: "Missing query or cursor" },
      { status: 400 }
    );
  }

  // If cursor is provided, follow it directly (it's a full next_href URL)
  const pathOrUrl = cursor || "/playlists";
  const queryParams = cursor
    ? undefined
    : {
        q: query,
        limit: "200",
        linked_partitioning: "true",
      };

  const res = await scReq<SCSearchResponse>("GET", pathOrUrl, token, {
    query: queryParams,
  });

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: "Search failed" },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({
    playlists: res.json.collection || [],
    nextCursor: res.json.next_href || null,
  });
}
