"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

export function AgentStatusToggle({ clientId, status }: { clientId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = status === "active";
  return (
    <Button
      variant={active ? "danger" : "secondary"}
      disabled={busy}
      className="px-3 py-1.5 text-xs"
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/admin/agents/${clientId}`, { body: { status: active ? "suspended" : "active" } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {active ? "Suspend" : "Re-enable"}
    </Button>
  );
}
