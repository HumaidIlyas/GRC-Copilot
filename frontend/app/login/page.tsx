"use client"

import { useState } from "react"
import { signInWithPopup, GoogleAuthProvider, getIdToken } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleSignIn() {
    setLoading(true)
    setError("")
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const idToken = await getIdToken(result.user)

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, email: result.user.email }),
      })
      if (!res.ok) throw new Error("Session creation failed")

      window.location.href = "/"
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5F0]">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="font-serif italic text-5xl text-[#1A1916] mb-3">GRC Copilot</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4]">NIST 800-53 Compliance Assistant</p>
        </div>
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-8">
          <p className="text-sm text-[#6B6762] mb-6 text-center">Sign in to access your compliance workspace</p>
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full py-3 px-4 bg-[#1A1916] text-white text-sm font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            {loading ? "Signing in..." : "Continue with Google"}
          </button>
          {error && <p className="mt-4 text-xs text-center text-red-600 font-mono">{error}</p>}
        </div>
      </div>
    </div>
  )
}
