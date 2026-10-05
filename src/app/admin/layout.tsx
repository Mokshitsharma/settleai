import Link from "next/link";
import { pageUser } from "@/lib/page-auth";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/risk", label: "Review queue" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/ledger", label: "Ledger" },
  { href: "/admin/mandates", label: "Agents and mandates" },
  { href: "/admin/traces", label: "AI runs" },
  { href: "/admin/eval", label: "Evaluation" },
  { href: "/admin/policy", label: "Risk policy" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await pageUser(["admin"]);
  return (
    <div>
      <nav aria-label="Admin sections" className="-mx-1 mb-6 flex flex-wrap gap-1 border-b border-vellum pb-2 text-sm">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="rounded px-2.5 py-1.5 font-medium text-ink-soft hover:bg-surface hover:text-ink">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
