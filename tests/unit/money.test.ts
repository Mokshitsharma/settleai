import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { feeForAmount, formatMinor, parseMajor, splitProportional } from "@/core/money";

describe("money", () => {
  it("formats minor units with two decimals", () => {
    expect(formatMinor(10200)).toBe("$102.00");
    expect(formatMinor(5)).toBe("$0.05");
  });

  it("parses major amounts without floating point error", () => {
    expect(parseMajor("102.00")).toBe(10200);
    expect(parseMajor("0.1")).toBe(10);
    expect(parseMajor("19.99")).toBe(1999);
    expect(() => parseMajor("1.999")).toThrow();
    expect(() => parseMajor("abc")).toThrow();
  });

  it("computes the 2% fee from the spec example", () => {
    expect(feeForAmount(10000, 200)).toBe(200);
    expect(feeForAmount(4000, 200)).toBe(80);
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatMinor(1.5)).toThrow();
    expect(() => feeForAmount(-1, 200)).toThrow();
  });

  it("proportional split always sums exactly to the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }),
        (total, weights) => {
          const parts = splitProportional(total, weights);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
        },
      ),
    );
  });
});
