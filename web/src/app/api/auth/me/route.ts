import { NextResponse } from "next/server";
import { getValidToken } from "@/lib/session";
import { scReq } from "@/lib/soundcloud/client";
import type { SCUser } from "@/lib/soundcloud/types";

export async function GET() {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const res = await scReq<SCUser>("GET", "/me", token);
  if (res.status !== 200 || !res.json) {
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({ user: res.json });
}
