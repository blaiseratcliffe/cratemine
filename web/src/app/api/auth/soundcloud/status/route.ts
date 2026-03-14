import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sc = await prisma.soundCloudAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      scUserId: true,
      scUsername: true,
      scAvatarUrl: true,
    },
  });

  return NextResponse.json({
    linked: !!sc,
    soundcloud: sc,
    role: session.user.role || "user",
  });
}
