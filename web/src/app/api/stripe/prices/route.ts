import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    pro: process.env.STRIPE_PRO_PRICE_ID || null,
    unlimited: process.env.STRIPE_UNLIMITED_PRICE_ID || null,
  });
}
