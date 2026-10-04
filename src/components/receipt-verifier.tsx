"use client";

import { useState } from "react";
import { verifyReceipt, type ReceiptVerification } from "@/core/verifier/receipt";
import { Button } from "./ui";

/** Runs the offline verifier in this browser. The platform key list is fetched only to pin the signature. */
async function runInBrowser(bundle: unknown): Promise<ReceiptVerification> {
  let trusted: string[] | undefined;
  try {
    trusted = ((await (await fetch("/api/keys/platform")).json()) as { keyIds: string[] }).keyIds;
  } catch {
    trusted = undefined;
  }
  return verifyReceipt(bundle, { trustedPlatformKeyIds: trusted });
}

export function VerificationResult({ result }: { result: ReceiptVerification }) {
  return (
    <div aria-live="polite" className={`mt-4 rounded-[10px] border-2 p-4 ${result.ok ? "border-seal" : "border-deny"}`}>
      <p className={`text-lg font-semibold ${result.ok ? "text-seal" : "text-deny"}`}>{result.ok ? "Receipt verified" : "Receipt failed verification"}</p>
      <ol className="mt-3 space-y-2 text-sm">
        {result.checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
            <span aria-label={c.ok ? "passed" : "failed"} className="font-bold" style={{ color: c.ok ? "var(--seal)" : "var(--deny)" }}>
              {c.ok ? "✓" : "✕"}
            </span>
            <span>
              <span className="font-semibold">{c.label}</span>: {c.detail}
              {c.pointer ? <span className="block font-mono text-xs text-deny">at {c.pointer}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {result.warnings.length ? (
        <ul className="mt-3 border-t border-vellum pt-2 text-xs text-ink-soft">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function VerifyThisReceipt({ jobId }: { jobId: string }) {
  const [result, setResult] = useState<ReceiptVerification | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(await runInBrowser(await (await fetch(`/api/receipts/${jobId}`)).json()));
          setBusy(false);
        }}
      >
        {busy ? "Verifying…" : "Verify in my browser"}
      </Button>
      {result ? <VerificationResult result={result} /> : null}
    </div>
  );
}

export function VerifyUpload() {
  const [result, setResult] = useState<ReceiptVerification | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function load(file: File) {
    setName(file.name);
    const text = await file.text();
    try {
      setResult(await runInBrowser(JSON.parse(text)));
    } catch {
      setResult({ ok: false, checks: [{ id: "json", label: "Receipt file", ok: false, detail: "The file is not valid JSON, so it cannot be a SettleAI receipt (even one changed byte can do this)" }], warnings: [] });
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-6 py-12 text-center ${drag ? "border-signal bg-[#e6ebfe]" : "border-vellum bg-surface"}`}
      >
        <span className="text-lg font-semibold">Drop a receipt file here</span>
        <span className="mt-1 text-sm text-ink-soft">or click to choose one. It is checked in this browser; nothing is uploaded.</span>
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
          }}
        />
      </label>
      {name ? <p className="mt-3 text-sm text-ink-soft">Checked: {name}</p> : null}
      {result ? <VerificationResult result={result} /> : null}
    </div>
  );
}
