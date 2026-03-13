import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/session";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUsersSearchResponse } from "@/lib/soundcloud/types";

/**
 * Search SoundCloud users. Used for scene discovery seed phase.
 * POST body: { query: string, cursor?: string }
 */
export async function POST(request: NextRequest) {
  const token = await getValidToken();
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

  const pathOrUrl = cursor || "/users";
  const queryParams = cursor
    ? undefined
    : {
        q: query,
        limit: "200",
        linked_partitioning: "true",
      };

  const res = await scReq<SCUsersSearchResponse>("GET", pathOrUrl, token, {
    query: queryParams,
  });

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `User search failed (${res.status})`, detail: res.text },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({
    users: res.json.collection || [],
    nextCursor: res.json.next_href || null,
  });
}
