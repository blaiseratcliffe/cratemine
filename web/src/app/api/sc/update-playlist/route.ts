import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/session";
import { addTracksSafe } from "@/lib/soundcloud/playlist-create";

/**
 * Add tracks to a playlist with 422 recovery.
 * POST body: { playlistId: number, knownGoodIds: number[], newIds: number[] }
 */
export async function POST(request: NextRequest) {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { playlistId, knownGoodIds, newIds } = await request.json();

  if (!playlistId || !Array.isArray(newIds)) {
    return NextResponse.json(
      { error: "Missing playlistId or newIds" },
      { status: 400 }
    );
  }

  try {
    const result = await addTracksSafe(
      playlistId,
      knownGoodIds || [],
      newIds,
      token
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
