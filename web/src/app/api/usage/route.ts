import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyCsrf } from "@/lib/csrf";
import { getEffectivePlan } from "@/lib/plans";

/**
 * POST /api/usage — Check and increment daily search usage.
 * Body: { type: "playlist_search" | "scene_discovery" }
 * Returns: { allowed: true } or { allowed: false, limit, used }
 */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { type } = await request.json();
  if (type !== "playlist_search" && type !== "scene_discovery") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      role: true,
      playlistSearchCount: true,
      playlistSearchDate: true,
      sceneDiscoveryCount: true,
      sceneDiscoveryDate: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const planConfig = getEffectivePlan(user.plan, user.role);
  const today = new Date().toISOString().slice(0, 10); // "2026-03-14"

  if (type === "playlist_search") {
    const limit = planConfig.maxPlaylistSearchesPerDay;
    // 0 = unlimited
    if (limit === 0) {
      // Increment counter for tracking but don't block
      const count = user.playlistSearchDate === today ? user.playlistSearchCount : 0;
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          playlistSearchCount: count + 1,
          playlistSearchDate: today,
        },
      });
      return NextResponse.json({ allowed: true, used: count + 1, limit: 0 });
    }

    const count = user.playlistSearchDate === today ? user.playlistSearchCount : 0;
    if (count >= limit) {
      return NextResponse.json({
        allowed: false,
        used: count,
        limit,
        message: `You've used all ${limit} playlist searches for today. Upgrade for more.`,
      });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        playlistSearchCount: count + 1,
        playlistSearchDate: today,
      },
    });

    return NextResponse.json({ allowed: true, used: count + 1, limit });
  }

  // scene_discovery
  const limit = planConfig.maxSceneDiscoveriesPerDay;
  if (limit === 0) {
    const count = user.sceneDiscoveryDate === today ? user.sceneDiscoveryCount : 0;
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        sceneDiscoveryCount: count + 1,
        sceneDiscoveryDate: today,
      },
    });
    return NextResponse.json({ allowed: true, used: count + 1, limit: 0 });
  }

  const count = user.sceneDiscoveryDate === today ? user.sceneDiscoveryCount : 0;
  if (count >= limit) {
    return NextResponse.json({
      allowed: false,
      used: count,
      limit,
      message: `You've used all ${limit} scene discoveries for today. Upgrade for more.`,
    });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      sceneDiscoveryCount: count + 1,
      sceneDiscoveryDate: today,
    },
  });

  return NextResponse.json({ allowed: true, used: count + 1, limit });
}

/**
 * GET /api/usage — Get current daily usage counts.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      role: true,
      playlistSearchCount: true,
      playlistSearchDate: true,
      sceneDiscoveryCount: true,
      sceneDiscoveryDate: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const planConfig = getEffectivePlan(user.plan, user.role);
  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    playlistSearch: {
      used: user.playlistSearchDate === today ? user.playlistSearchCount : 0,
      limit: planConfig.maxPlaylistSearchesPerDay,
    },
    sceneDiscovery: {
      used: user.sceneDiscoveryDate === today ? user.sceneDiscoveryCount : 0,
      limit: planConfig.maxSceneDiscoveriesPerDay,
    },
  });
}
