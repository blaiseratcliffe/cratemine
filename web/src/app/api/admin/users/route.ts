import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyCsrf } from "@/lib/csrf";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== "admin") return null;
  return session;
}

/** GET: List all users (admin only) */
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      plan: true,
      createdAt: true,
      soundcloudAccount: {
        select: {
          scUsername: true,
          scUserId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

/** PATCH: Update a user's role (admin only) */
export async function PATCH(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, role, plan } = await request.json();

  // Plan change (admin testing their own plan)
  if (plan && ["free", "pro", "unlimited"].includes(plan)) {
    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Can only change your own plan for testing" }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { plan },
    });
    return NextResponse.json({ ok: true });
  }

  // Role change
  if (!userId || !["user", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Prevent self-demotion
  if (userId === session.user.id && role !== "admin") {
    return NextResponse.json(
      { error: "Cannot demote yourself" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  return NextResponse.json({ ok: true });
}
