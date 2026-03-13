import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUsersSearchResponse } from "@/lib/soundcloud/types";

/**
 * Fetch a user's followings. Single page (200 max) for speed.
 */
export async function GET(
  _request: NextRequest,
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

  const res = await scReq<SCUsersSearchResponse>(
    "GET",
    `/users/${id}/followings`,
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
      { error: `Failed to fetch followings (${res.status})` },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({ users: res.json.collection || [] });
}
