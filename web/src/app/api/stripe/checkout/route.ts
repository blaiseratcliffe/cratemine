import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { verifyCsrf } from "@/lib/csrf";

/**
 * Create a Stripe Checkout session for upgrading to Pro or Unlimited.
 * POST body: { priceId: string }
 */
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { priceId } = await request.json();
  if (!priceId) {
    return NextResponse.json({ error: "Missing priceId" }, { status: 400 });
  }

  const stripe = getStripe();
  const origin =
    process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";

  // Get or create Stripe customer
  let sub = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });

  let customerId: string;

  if (sub?.stripeCustomerId) {
    customerId = sub.stripeCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email: session.user.email || undefined,
      name: session.user.name || undefined,
      metadata: { userId: session.user.id },
    });
    customerId = customer.id;

    // Create or update subscription record with customer ID
    await prisma.subscription.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        stripeCustomerId: customerId,
        status: "inactive",
      },
      update: {
        stripeCustomerId: customerId,
      },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard?upgraded=true`,
    cancel_url: `${origin}/dashboard/pricing`,
    subscription_data: {
      metadata: { userId: session.user.id },
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
