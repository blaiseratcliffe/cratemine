import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCTrackRaw } from "@/lib/soundcloud/types";

/**
 * Fetch all tracks for a playlist. Follows pagination within the call.
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
  const tracks: SCTrackRaw[] = [];
  let url: string | null = `/playlists/${id}/tracks`;
  const query: Record<string, string> = {
    limit: "200",
    linked_partitioning: "true",
  };
  const seenHrefs = new Set<string>();

  while (url) {
    // Loop detection
    if (seenHrefs.has(url)) break;
    seenHrefs.add(url);

    const isFullUrl = url.startsWith("http");
    type TracksPage = { collection: SCTrackRaw[]; next_href: string | null };
    const res: Awaited<ReturnType<typeof scReq<TracksPage>>> = await scReq<TracksPage>(
      "GET",
      url,
      token,
      { query: isFullUrl ? undefined : query }
    );

    if (res.status !== 200 || !res.json) {
      // If first page fails, return error. Otherwise return what we have.
      if (tracks.length === 0) {
        return NextResponse.json(
          { error: `Failed to fetch tracks (${res.status})` },
          { status: res.status || 500 }
        );
      }
      break;
    }

    if (res.json.collection) {
      tracks.push(...res.json.collection);
    }

    url = res.json.next_href || null;
  }

  return NextResponse.json({ tracks });
}
