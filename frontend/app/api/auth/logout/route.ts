import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete("grc_session")
  return NextResponse.json({ ok: true })
}
