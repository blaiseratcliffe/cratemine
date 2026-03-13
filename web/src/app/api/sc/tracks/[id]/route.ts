import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCTrackRaw } from "@/lib/soundcloud/types";

/**
 * Fetch a single track's full details (for metric enrichment).
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
  const res = await scReq<SCTrackRaw>("GET", `/tracks/${id}`, token);

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: `Failed to fetch track (${res.status})` },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({ track: res.json });
}
