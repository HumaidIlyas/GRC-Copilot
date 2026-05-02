import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SignOutButton from "./components/SignOutButton";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GRC Copilot",
  description: "NIST 800-53 compliance assistant for GRC analysts",
};

const NAV = [
  { href: "/",     label: "Dashboard" },
  { href: "/ssp",  label: "SSP" },
  { href: "/odp",  label: "ODP Tracking" },
  { href: "/gap",  label: "Gap Assessment" },
  { href: "/poam", label: "POA&M" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-8 sticky top-0 z-10">
          <span className="font-bold text-blue-700 text-lg tracking-tight">GRC Copilot</span>
          <nav className="flex gap-1">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>
          <SignOutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
