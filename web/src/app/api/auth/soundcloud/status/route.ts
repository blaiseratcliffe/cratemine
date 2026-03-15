import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Read plan and role directly from DB (not session cache) for freshness
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      plan: true,
      soundcloudAccount: {
        select: {
          scUserId: true,
          scUsername: true,
          scAvatarUrl: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    linked: !!user.soundcloudAccount,
    soundcloud: user.soundcloudAccount,
    role: user.role,
    plan: user.plan,
  });
}
