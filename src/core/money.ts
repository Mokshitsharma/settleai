// Money is always an integer number of minor units (cents). Never use floats for amounts.

export type Minor = number;

export function assertMinor(value: number, label = "amount"): asserts value is Minor {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer in minor units, got ${value}`);
}

export function assertNonNegativeMinor(value: number, label = "amount"): asserts value is Minor {
  assertMinor(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative, got ${value}`);
}

/** The single formatter for displaying money. 12345 USD -> "$123.45". */
export function formatMinor(amount: Minor, currency = "USD"): string {
  assertMinor(amount);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount / 100);
}

/** Parse "123.45" into 12345 without floating point arithmetic. */
export function parseMajor(input: string): Minor {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid money amount: ${input}`);
  const value = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -value : value;
}

/** Platform fee in basis points, rounded half up to the nearest minor unit. */
export function feeForAmount(amount: Minor, feeBps: number): Minor {
  assertNonNegativeMinor(amount);
  return Math.floor((amount * feeBps + 5000) / 10000);
}

export interface FeeSchedule {
  marginBps: number;
  /** What PayPal charges on a capture (percentage of the whole charge, plus a fixed amount) and per payout item. */
  processingBps: number;
  processingFixedMinor: Minor;
  payoutItemFeeMinor: Minor;
}

export interface ServiceFee {
  feeMinor: Minor;
  processingMinor: Minor;
  marginMinor: Minor;
}

/**
 * What the payer pays above the work: PayPal's costs passed through, plus SettleAI's margin. PayPal's percentage applies
 * to the whole charge, including this fee, so the charge is grossed up and rounded up: after PayPal's cut the platform
 * still holds the work, the payout fees and the margin. With no PayPal costs (mock mode) the fee is just the margin.
 */
export function serviceFee(totalMinor: Minor, payoutItems: number, s: FeeSchedule): ServiceFee {
  assertNonNegativeMinor(totalMinor);
  const marginMinor = feeForAmount(totalMinor, s.marginBps);
  const free = s.processingBps === 0 && s.processingFixedMinor === 0 && s.payoutItemFeeMinor === 0;
  if (free || totalMinor === 0) return { feeMinor: marginMinor, processingMinor: 0, marginMinor };
  const needed = totalMinor + marginMinor + payoutItems * s.payoutItemFeeMinor + s.processingFixedMinor;
  const charge = Math.ceil((needed * 10000) / (10000 - s.processingBps));
  const feeMinor = charge - totalMinor;
  return { feeMinor, processingMinor: feeMinor - marginMinor, marginMinor };
}

/** Split `total` into parts proportional to `weights`; the remainder goes to the first parts so the sum is exact. */
export function splitProportional(total: Minor, weights: number[]): Minor[] {
  assertNonNegativeMinor(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("weights must sum to a positive number");
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i]++;
  return parts;
}
