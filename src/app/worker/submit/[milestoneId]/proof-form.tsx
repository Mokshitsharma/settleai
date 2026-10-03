"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AcceptanceCriterion } from "@/core/contracts";
import { api } from "@/lib/api";
import { Button, Panel } from "@/components/ui";

const SAMPLES = [
  { variant: "genuine", label: "Photo at the right place" },
  { variant: "far", label: "Photo 5 km away" },
  { variant: "reused", label: "Photo reused from another job" },
  { variant: "noexif", label: "Photo with no metadata" },
] as const;

/** Mobile-first proof capture: camera, location with consent, confirmation text, then one Submit. */
export function ProofForm({ milestoneId, jobId, criteria }: { milestoneId: string; jobId: string; criteria: AcceptanceCriterion[] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsText = criteria.some((c) => c.evidenceType === "text");

  async function upload(file: File) {
    setBusy("Uploading photo…");
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/milestones/${milestoneId}/proofs`, { method: "POST", body: form });
      const data = (await res.json()) as { added?: string[]; error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? "Upload failed");
      setPhotos((p) => [...p, ...(data.added ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sample(variant: (typeof SAMPLES)[number]["variant"]) {
    setBusy("Adding demo photo…");
    setError(null);
    try {
      const { proofId } = await api<{ proofId: string }>("/api/dev/sample-proof", { body: { milestoneId, variant } });
      setPhotos((p) => [...p, proofId]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function locate() {
    setLocError(null);
    if (!navigator.geolocation) return setLocError("This browser cannot share location.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      () => setLocError("Location was not shared. Photos with GPS still work."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit() {
    setBusy("Submitting…");
    setError(null);
    try {
      if (text.trim() || location) {
        const form = new FormData();
        if (text.trim()) form.append("text", text.trim());
        if (location) {
          form.append("lat", String(location.lat));
          form.append("lng", String(location.lng));
          form.append("accuracy", String(location.accuracy));
        }
        const res = await fetch(`/api/milestones/${milestoneId}/proofs`, { method: "POST", body: form });
        if (!res.ok) throw new Error(((await res.json()) as { error?: { message: string } }).error?.message ?? "Could not save");
      }
      await api(`/api/milestones/${milestoneId}/submit`, { method: "POST" });
      router.push(`/jobs/${jobId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <Panel className="p-4">
        <h2 className="font-semibold">What you need to prove</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {criteria.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span aria-hidden className="mt-1 h-3 w-3 shrink-0 rounded-sm border-2 border-ink-faint" />
              {c.text}
            </li>
          ))}
        </ul>
      </Panel>

      <section>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-signal/50 bg-surface px-4 py-8 text-center hover:border-signal">
          <span className="text-lg font-semibold text-signal">Take or choose a photo</span>
          <span className="mt-1 text-sm text-ink-soft">Keep location on so the photo records where it was taken</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
        {photos.length ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {photos.map((id) => (
              // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked proof images
              <img key={id} src={`/api/proofs/${id}/image`} alt="Your proof photo" className="h-20 w-28 shrink-0 rounded-md border border-vellum object-cover" />
            ))}
          </div>
        ) : null}
        <details className="mt-3 rounded-md border border-vellum bg-surface px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink-soft">No phone at the job site? Use a demo photo</summary>
          <p className="mt-2 text-xs text-ink-faint">Generated photos with real capture time and GPS, marked as demo samples. Each one exercises a different check.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SAMPLES.map((s) => (
              <Button key={s.variant} variant="secondary" disabled={busy !== null} onClick={() => sample(s.variant)} className="text-xs">
                {s.label}
              </Button>
            ))}
          </div>
        </details>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={locate} disabled={busy !== null}>
          {location ? "Location added" : "Share my location"}
        </Button>
        {location ? <span className="text-sm text-ink-soft">Within about {location.accuracy} m</span> : null}
        {locError ? <span className="text-sm text-hold">{locError}</span> : null}
      </section>

      {needsText ? (
        <label className="block text-sm font-semibold">
          Recipient name or note
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Who received it?"
            className="mt-1 w-full rounded-md border border-vellum bg-surface px-3 py-2.5 font-normal outline-none focus:border-signal"
          />
        </label>
      ) : null}

      <Button onClick={submit} disabled={busy !== null || photos.length === 0} className="w-full py-3 text-base">
        {busy ?? "Submit for verification"}
      </Button>
      {photos.length === 0 ? <p className="text-center text-sm text-ink-soft">Add at least one photo first.</p> : null}
      {error ? <p role="alert" className="text-sm text-deny">{error}</p> : null}
    </div>
  );
}
