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
      className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors ml-auto"
    >
      Sign Out
    </button>
  )
}
