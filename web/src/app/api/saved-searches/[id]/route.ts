import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyCsrf } from "@/lib/csrf";

/** DELETE: Remove a saved search */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Only delete if it belongs to the user
  const deleted = await prisma.savedSearch.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
