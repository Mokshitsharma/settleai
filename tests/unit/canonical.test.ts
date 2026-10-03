import { describe, expect, it } from "vitest";
import { canonicalize, hashCanonical, sha256Hex, timingSafeEqualStr } from "@/core/mandates/canonical";

describe("canonical JSON and hashing (known-answer tests)", () => {
  it("SHA-256 known answers", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("RFC 8785 sorts keys and normalizes numbers", () => {
    expect(canonicalize({ b: 2, a: [1, { d: true, c: null }], e: 1.0 })).toBe('{"a":[1,{"c":null,"d":true}],"b":2,"e":1}');
    expect(canonicalize({ x: 1e21 })).toBe('{"x":1e+21}');
  });

  it("key order does not change the hash", () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it("any change to a value changes the hash", () => {
    expect(hashCanonical({ amount: 15000 })).not.toBe(hashCanonical({ amount: 15001 }));
  });

  it("constant-time compare", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "ab")).toBe(false);
  });
});
