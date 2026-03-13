import { NextRequest, NextResponse } from "next/server";
import { getValidSCToken } from "@/lib/soundcloud/tokens";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUserFull } from "@/lib/soundcloud/types";

/**
 * Resolve a SoundCloud URL to a user object.
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

  const res = await scReq<SCUserFull>("GET", "/resolve", token, {
    query: { url },
  });

  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: "Resolve failed" },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({ user: res.json });
}
