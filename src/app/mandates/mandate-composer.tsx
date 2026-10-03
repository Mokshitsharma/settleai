"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntentMandatePayload } from "@/core/contracts";
import type { MandateView } from "@/core/services/mandates";
import { parseMajor } from "@/core/money";
import { api } from "@/lib/api";
import { browserKeysSupported, getBrowserKey, signWithBrowserKey } from "@/lib/browser-keys";
import { Button, Panel } from "@/components/ui";
import { MandateCard } from "./mandate-card";

const CATEGORIES = [
  { value: "delivery", label: "Deliveries" },
  { value: "onsite_service", label: "On-site services" },
  { value: "digital_deliverable", label: "Digital work" },
] as const;

const AREAS = {
  indore: { lat: 22.7196, lng: 75.8577, radiusKm: 25, label: "Indore" },
  none: undefined,
} as const;

type KeyChoice = "browser" | "managed";

const field = "mt-1 w-full rounded-md border border-vellum bg-surface px-3 py-2 outline-none focus:border-signal";

export function MandateComposer({
  userId,
  clients,
  keyMode,
}: {
  userId: string;
  clients: { id: string; name: string }[];
  keyMode: "browser" | "managed" | "both";
}) {
  const router = useRouter();
  const [agent, setAgent] = useState(clients[0]?.id ?? "");
  const [categories, setCategories] = useState<string[]>(["delivery"]);
  const [perJob, setPerJob] = useState("150");
  const [total, setTotal] = useState("400");
  const [perDay, setPerDay] = useState("5");
  const [hours, setHours] = useState("24");
  const [area, setArea] = useState<keyof typeof AREAS>("indore");
  const [minTrust, setMinTrust] = useState("40");
  const [stepUp, setStepUp] = useState("100");
  const [keyChoice, setKeyChoice] = useState<KeyChoice>(keyMode === "managed" ? "managed" : "browser");
  const [draft, setDraft] = useState<{ payload: IntentMandatePayload; plainLanguage: string } | null>(null);
  const [signed, setSigned] = useState<MandateView | null>(null);
  const [busy, setBusy] = useState<"preview" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Any change to the terms invalidates the previewed draft: you only ever sign what you just read.
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setDraft(null);
    };
  // Browsers without IndexedDB/WebCrypto fall back to the managed demo key.
  const effectiveKey = (): KeyChoice => (keyChoice === "browser" && !browserKeysSupported() ? "managed" : keyChoice);

  async function preview() {
    setBusy("preview");
    setError(null);
    setSigned(null);
    try {
      const keyId =
        effectiveKey() === "browser"
          ? (await getBrowserKey(userId)).keyId
          : (await api<{ keyId: string }>("/api/keys", { body: { mode: "managed" } })).keyId;
      const maxPerJobMinor = parseMajor(perJob);
      setDraft(
        await api("/api/mandates/draft", {
          body: {
            keyId,
            agentClientId: agent,
            categories,
            maxPerJobMinor,
            maxTotalMinor: parseMajor(total),
            maxJobsPerDay: Number(perDay),
            ttlSeconds: Math.round(Number(hours) * 3600),
            geoFence: AREAS[area],
            minTrustScore: Number(minTrust),
            requirePayPalEmail: true,
            prohibitedKeywords: ["gift card", "crypto", "cash"],
            stepUpAboveMinor: parseMajor(stepUp),
            maxAutoReleaseMinor: Math.min(maxPerJobMinor, 5000),
          },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    if (!draft) return;
    setBusy("sign");
    setError(null);
    try {
      const body =
        effectiveKey() === "browser"
          ? { payload: draft.payload, jws: (await signWithBrowserKey(userId, draft.payload)).jws }
          : { payload: draft.payload, signing: "managed" };
      const { mandate } = await api<{ mandate: MandateView }>("/api/mandates", { body });
      setSigned(mandate);
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (clients.length === 0) {
    return <p className="mt-3 text-sm text-ink-soft">You have no AI agents connected yet.</p>;
  }

  return (
    <div className="mt-3 space-y-4">
      <Panel className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Agent
            <select value={agent} onChange={(e) => edit(setAgent)(e.target.value)} className={field}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="text-sm sm:col-span-2">
            <legend className="font-medium">May hire for</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = categories.includes(c.value);
                return (
                  <label key={c.value} className={`cursor-pointer rounded-full border px-3 py-1 ${on ? "border-signal bg-[#e6ebfe] text-signal-ink" : "border-vellum"}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => edit(setCategories)(on ? categories.filter((x) => x !== c.value) : [...categories, c.value])}
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="text-sm font-medium">
            Per job, USD
            <input inputMode="decimal" value={perJob} onChange={(e) => edit(setPerJob)(e.target.value)} className={`${field} num`} />
          </label>
          <label className="text-sm font-medium">
            In total, USD
            <input inputMode="decimal" value={total} onChange={(e) => edit(setTotal)(e.target.value)} className={`${field} num`} />
          </label>
          <label className="text-sm font-medium">
            Jobs per day
            <input inputMode="numeric" value={perDay} onChange={(e) => edit(setPerDay)(e.target.value)} className={`${field} num`} />
          </label>
          <label className="text-sm font-medium">
            Valid for, hours
            <input inputMode="decimal" value={hours} onChange={(e) => edit(setHours)(e.target.value)} className={`${field} num`} />
          </label>
          <label className="text-sm font-medium">
            Area
            <select value={area} onChange={(e) => edit(setArea)(e.target.value as keyof typeof AREAS)} className={field}>
              <option value="indore">Within 25 km of Indore</option>
              <option value="none">Anywhere</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Ask me first above, USD
            <input inputMode="decimal" value={stepUp} onChange={(e) => edit(setStepUp)(e.target.value)} className={`${field} num`} />
          </label>
          <label className="text-sm font-medium">
            Minimum worker trust score
            <input inputMode="numeric" value={minTrust} onChange={(e) => edit(setMinTrust)(e.target.value)} className={`${field} num`} />
          </label>
          {keyMode === "both" ? (
            <fieldset className="text-sm">
              <legend className="font-medium">Sign with</legend>
              <label className="mt-1.5 flex items-center gap-2">
                <input type="radio" checked={keyChoice === "browser"} onChange={() => edit(setKeyChoice)("browser")} />
                This browser&apos;s key
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={keyChoice === "managed"} onChange={() => edit(setKeyChoice)("managed")} />
                Demo key held by SettleAI
              </label>
            </fieldset>
          ) : null}
        </div>
        <Button variant="secondary" onClick={preview} disabled={busy !== null || !agent || categories.length === 0} className="mt-5">
          {busy === "preview" ? "Preparing…" : "Preview in plain words"}
        </Button>
      </Panel>

      {draft ? (
        <Panel className="border-ink/30 p-5">
          <p className="text-sm font-semibold text-ink-soft">You are about to sign</p>
          <p className="mt-2 text-lg leading-snug">{draft.plainLanguage}</p>
          <p className="mt-3 text-xs text-ink-faint">
            {effectiveKey() === "browser"
              ? "Signed in this browser with a key that never leaves your device."
              : "Signed with a demo key that SettleAI holds for you (for trying the demo on any device)."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={sign} disabled={busy !== null}>
              {busy === "sign" ? "Signing…" : "Sign mandate"}
            </Button>
            <Button variant="quiet" onClick={() => setDraft(null)} disabled={busy !== null}>
              Change terms
            </Button>
          </div>
        </Panel>
      ) : null}

      {signed ? <MandateCard mandate={signed} fresh /> : null}
      {error ? <p role="alert" className="text-sm text-deny">{error}</p> : null}
    </div>
  );
}
