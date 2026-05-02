import { cookies } from "next/headers"
import { SignJWT } from "jose"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const { idToken, email } = await req.json()

  if (!idToken || !email) {
    return NextResponse.json({ error: "Missing token or email" }, { status: 400 })
  }

  const secret = new TextEncoder().encode(
    process.env.SESSION_SECRET ?? "dev-only-insecure-secret"
  )
  const jwt = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret)

  const cookieStore = await cookies()
  cookieStore.set("grc_session", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24,
    sameSite: "lax",
    path: "/",
  })

  return NextResponse.json({ ok: true })
}
