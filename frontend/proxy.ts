import { NextRequest, NextResponse } from "next/server"
import { jwtVerify } from "jose"

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/_next", "/favicon.ico"]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const session = req.cookies.get("grc_session")?.value
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  try {
    const secret = new TextEncoder().encode(
      process.env.SESSION_SECRET ?? "dev-only-insecure-secret"
    )
    await jwtVerify(session, secret)
    return NextResponse.next()
  } catch {
    const res = NextResponse.redirect(new URL("/login", req.url))
    res.cookies.delete("grc_session")
    return res
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
