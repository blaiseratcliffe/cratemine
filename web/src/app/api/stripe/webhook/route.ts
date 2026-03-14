import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * Stripe webhook handler.
 * Listens for subscription lifecycle events and updates user plan accordingly.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[stripe] Webhook signature verification failed: ${msg}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(sub);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
    }
  } catch (err) {
    console.error(`[stripe] Error handling ${event.type}:`, err);
  }

  return NextResponse.json({ received: true });
}

/** Map Stripe price ID to plan name */
function priceToPlan(priceId: string): string {
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const unlimitedPriceId = process.env.STRIPE_UNLIMITED_PRICE_ID;

  if (priceId === proPriceId) return "pro";
  if (priceId === unlimitedPriceId) return "unlimited";
  return "free";
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) return;

  const stripe = getStripe();
  const subResponse = await stripe.subscriptions.retrieve(subscriptionId);
  const subscription = subResponse as Stripe.Subscription;
  const userId = subscription.metadata.userId;
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? priceToPlan(priceId) : "free";

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      status: "active",
      currentPeriodEnd: new Date((subscription.items.data[0]?.current_period_end ?? 0) * 1000),
    },
    update: {
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      status: "active",
      currentPeriodEnd: new Date((subscription.items.data[0]?.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: false,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { plan },
  });

  console.log(`[stripe] User ${userId} upgraded to ${plan}`);
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const userId = subscription.metadata.userId;
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? priceToPlan(priceId) : "free";
  const status = subscription.status === "active" ? "active"
    : subscription.status === "past_due" ? "past_due"
    : subscription.status === "canceled" ? "cancelled"
    : "inactive";

  await prisma.subscription.update({
    where: { userId },
    data: {
      stripePriceId: priceId,
      status,
      currentPeriodEnd: new Date((subscription.items.data[0]?.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });

  // Only downgrade plan if subscription is actually cancelled/inactive
  if (status === "active") {
    await prisma.user.update({
      where: { id: userId },
      data: { plan },
    });
  }

  console.log(`[stripe] Subscription updated for ${userId}: ${status} (${plan})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata.userId;
  if (!userId) return;

  await prisma.subscription.update({
    where: { userId },
    data: { status: "cancelled" },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { plan: "free" },
  });

  console.log(`[stripe] User ${userId} downgraded to free (subscription cancelled)`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  if (!customerId) return;

  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "past_due" },
    });
    console.log(`[stripe] Payment failed for customer ${customerId}`);
  }
}
