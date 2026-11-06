import type { Metadata } from "next";
import Link from "next/link";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import { currentUser } from "@/core/auth/session";
import { ModeBadge, StubBanner } from "@/components/mode-badge";
import { RoleSwitcher } from "@/components/role-switcher";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "SettleAI", template: "%s | SettleAI" },
  description: "Agents hire people. SettleAI makes sure the work was done before PayPal pays.",
};

const NAV: Record<string, { href: string; label: string }[]> = {
  payer: [
    { href: "/jobs", label: "Jobs" },
    { href: "/new", label: "New job" },
    { href: "/mandates", label: "Agent mandates" },
  ],
  worker: [{ href: "/jobs", label: "My jobs" }],
  admin: [
    { href: "/admin", label: "Admin console" },
    { href: "/jobs", label: "All jobs" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${schibsted.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-vellum bg-surface">
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--ink)" strokeWidth="2" />
                <path d="M7.5 12.5l3 3 6-7" fill="none" stroke="var(--seal)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              SettleAI
            </Link>
            {user ? (
              <nav className="flex gap-1 text-sm">
                {NAV[user.role].map((n) => (
                  <Link key={n.href} href={n.href} className="rounded px-2.5 py-1.5 font-medium text-ink-soft hover:bg-paper hover:text-ink">
                    {n.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <Link href="/verify" className="rounded px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink">
              Verify a receipt
            </Link>
            <div className="ml-auto flex items-center gap-4">
              <ModeBadge />
              <RoleSwitcher current={user?.role} />
            </div>
          </div>
        </header>
        <StubBanner />
        <div className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
