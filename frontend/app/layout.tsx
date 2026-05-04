import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SignOutButton from "./components/SignOutButton";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "GRC Copilot",
  description: "NIST 800-53 compliance assistant for GRC analysts",
};

const NAV = [
  { href: "/",     label: "Dashboard" },
  { href: "/odp",  label: "ODP" },
  { href: "/gap",  label: "Gap" },
  { href: "/poam", label: "POA&M" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#F7F5F0] text-[#1A1916]">
        <header className="bg-white border-b border-[#E5E0D8] px-8 py-4 flex items-center gap-10 sticky top-0 z-10">
          <span className="font-serif italic text-xl text-[#1A1916]">GRC Copilot</span>
          <nav className="flex gap-8">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] hover:text-[#1A1916] transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>
          <SignOutButton />
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </body>
    </html>
  );
}
