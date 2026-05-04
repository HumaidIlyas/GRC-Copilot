"use client"

import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useRouter } from "next/navigation"

export default function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await signOut(auth)
    await fetch("/api/auth/logout", { method: "DELETE" })
    router.push("/login")
  }

  return (
    <button
      onClick={handleSignOut}
      className="ml-auto font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] hover:text-[#1A1916] transition-colors"
    >
      Sign Out
    </button>
  )
}
