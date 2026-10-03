import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ModeBadge } from "@/components/mode-badge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SettleAI",
  description: "The accountability layer for agentic commerce: mandates, verified outcomes, PayPal settlement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
          <span className="font-semibold tracking-tight">SettleAI</span>
          <ModeBadge />
        </header>
        {children}
      </body>
    </html>
  );
}
