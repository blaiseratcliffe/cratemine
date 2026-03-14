import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { auth } from "@/lib/auth";
import { verifyCsrf } from "@/lib/csrf";

const TO_EMAIL = "b.ratcliffe@gmail.com";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

function getFromEmail() {
  return process.env.RESEND_FROM_EMAIL || "CrateMine <onboarding@resend.dev>";
}

export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { type, message } = await request.json();

  if (!type || !message?.trim()) {
    return NextResponse.json({ error: "Missing type or message" }, { status: 400 });
  }

  if (type !== "report" && type !== "feedback") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const subject =
    type === "report"
      ? `[CrateMine] Issue Report from ${session.user.name || session.user.email}`
      : `[CrateMine] Feedback from ${session.user.name || session.user.email}`;

  try {
    await getResend().emails.send({
      from: getFromEmail(),
      to: TO_EMAIL,
      subject,
      text: [
        `Type: ${type === "report" ? "Issue Report" : "Feedback"}`,
        `From: ${session.user.name || "Unknown"} (${session.user.email || "no email"})`,
        `User ID: ${session.user.id}`,
        `Date: ${new Date().toISOString()}`,
        "",
        "Message:",
        message.trim(),
      ].join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[feedback] Failed to send email:", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
