"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { api } from "@/lib/api";

const ROLES = [
  { role: "payer", label: "Payer", who: "Ravi Traders", home: "/jobs" },
  { role: "worker", label: "Worker", who: "Asha K.", home: "/jobs" },
  { role: "admin", label: "Admin", who: "Meera", home: "/jobs" },
] as const;

/** Demo role switcher (spec F01): judges move between the three sides of a job in one click. */
export function RoleSwitcher({ current, size = "compact" }: { current?: string; size?: "compact" | "large" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (size === "large") {
    return (
      <div role="group" aria-label="View as" className="flex flex-wrap gap-3">
        {ROLES.map((r, i) => (
          <button
            key={r.role}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await api("/api/auth/demo-login", { body: { role: r.role } });
                router.push(r.home);
                router.refresh();
              })
            }
            className={`rounded-md px-5 py-3 text-left transition-colors disabled:opacity-60 ${
              i === 0 ? "bg-signal text-white hover:bg-signal-ink" : "border border-vellum bg-surface hover:border-ink-faint"
            }`}
          >
            <span className="block font-semibold">{r.label}</span>
            <span className={`block text-xs ${i === 0 ? "text-white/80" : "text-ink-soft"}`}>{r.who}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="group" aria-label="View as" className="flex rounded-md border border-vellum bg-surface p-0.5 text-sm">
      {ROLES.map((r) => {
        const active = r.role === current;
        return (
          <button
            key={r.role}
            type="button"
            disabled={pending}
            aria-pressed={active}
            title={`View as ${r.who}`}
            onClick={() =>
              start(async () => {
                await api("/api/auth/demo-login", { body: { role: r.role } });
                if (!current) router.push(r.home);
                router.refresh();
              })
            }
            className={`rounded px-3 py-1 font-semibold transition-colors ${
              active ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
