import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sub = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No subscription" }, { status: 400 });
  }

  const stripe = getStripe();
  const origin =
    process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
