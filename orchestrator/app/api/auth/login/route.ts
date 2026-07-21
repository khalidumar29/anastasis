import { NextRequest } from "next/server";
import { getUserByEmail } from "@/lib/db/client";
import { verifyPassword, createSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = body?.email;
  const password = body?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = getUserByEmail(email.trim().toLowerCase());
  // Same message for unknown email and wrong password — don't leak which.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return Response.json(
    { ok: true, name: user.name },
    { headers: { "Set-Cookie": createSessionCookie(user.id) } }
  );
}
