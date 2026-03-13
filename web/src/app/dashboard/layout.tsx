import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const sc = await prisma.soundCloudAccount.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!sc) {
    redirect("/link-soundcloud");
  }

  return <>{children}</>;
}
