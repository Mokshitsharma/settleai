import { ulid } from "ulid";

/** ULID with a short readable prefix, e.g. "job_01J9ZQ...". */
export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "n_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
