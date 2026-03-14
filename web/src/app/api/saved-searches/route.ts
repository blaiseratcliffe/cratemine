import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyCsrf } from "@/lib/csrf";
import { getEffectivePlan } from "@/lib/plans";

/** GET: List user's saved searches */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const searches = await prisma.savedSearch.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      createdAt: true,
    },
  });

  const planConfig = getEffectivePlan(
    (session.user as { plan?: string }).plan || "free",
    session.user.role || "user"
  );

  return NextResponse.json({
    searches: searches.map((s) => ({
      ...s,
      config: JSON.parse(s.config),
    })),
    limit: planConfig.maxSavedSearches,
    count: searches.length,
  });
}

/** POST: Save a search config */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const planConfig = getEffectivePlan(
    (session.user as { plan?: string }).plan || "free",
    session.user.role || "user"
  );

  // Check if saves are allowed on this plan
  if (planConfig.maxSavedSearches === 0 && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Saved searches require a Pro or Unlimited plan" },
      { status: 403 }
    );
  }

  // Check limit (0 = unlimited for admin)
  if (planConfig.maxSavedSearches > 0) {
    const count = await prisma.savedSearch.count({
      where: { userId: session.user.id },
    });
    if (count >= planConfig.maxSavedSearches) {
      return NextResponse.json(
        { error: `You've reached your limit of ${planConfig.maxSavedSearches} saved searches. Upgrade for more.` },
        { status: 403 }
      );
    }
  }

  const { name, type, config } = await request.json();

  if (!name?.trim() || !type || !config) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!["playlist_search", "scene_discovery"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const saved = await prisma.savedSearch.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      type,
      config: JSON.stringify(config),
    },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    search: { ...saved, config: JSON.parse(saved.config) },
  });
}
