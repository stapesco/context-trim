import { describe, it, expect } from "vitest";
import { assertNodeVersion, nodeMajor } from "../src/node-check.js";

describe("assertNodeVersion", () => {
  it("does not exit when running on Node >= 18", () => {
    const realVersion = process.versions.node;
    const major = parseInt(realVersion.split(".")[0] ?? "0", 10);
    if (major < 18) {
      return; // skip on ancient node
    }
    expect(() => assertNodeVersion()).not.toThrow();
  });
});

describe("nodeMajor", () => {
  it("parses a plain major.minor.patch version", () => {
    expect(nodeMajor("20.0.0")).toBe(20);
    expect(nodeMajor("18.17.1")).toBe(18);
    expect(nodeMajor("21.7.3")).toBe(21);
  });

  it("parses a v-prefixed version", () => {
    expect(nodeMajor("v18.0.0")).toBe(18);
    expect(nodeMajor("V20.10.0")).toBe(20);
  });

  it("parses a version with a pre-release suffix", () => {
    expect(nodeMajor("20.0.0-rc.1")).toBe(20);
    expect(nodeMajor("v22.0.0-nightly20240101")).toBe(22);
  });

  it("parses a version with build metadata suffix", () => {
    expect(nodeMajor("20.0.0+sha.abc123")).toBe(20);
  });

  it("parses a major-only version", () => {
    expect(nodeMajor("18")).toBe(18);
  });

  it("returns an old major for a too-old version", () => {
    expect(nodeMajor("16.20.0")).toBe(16);
    expect(nodeMajor("v14.0.0")).toBe(14);
  });

  it("parses a 2-segment version (major.minor)", () => {
    expect(nodeMajor("v20.0")).toBe(20);
    expect(nodeMajor("18.0")).toBe(18);
  });

  it("throws on malformed input", () => {
    expect(() => nodeMajor("not-a-version")).toThrow();
    expect(() => nodeMajor("")).toThrow();
    expect(() => nodeMajor("abc.def.ghi")).toThrow();
    expect(() => nodeMajor("v")).toThrow();
    expect(() => nodeMajor(".")).toThrow();
    expect(() => nodeMajor("..")).toThrow();
    expect(() => nodeMajor("20..0")).toThrow();
    expect(() => nodeMajor("v20.0.0 extra")).toThrow();
    expect(() => nodeMajor("hello 20.0.0 world")).toThrow();
  });

  it("does not mutate the runtime Node version", () => {
    const before = process.versions.node;
    expect(() => nodeMajor("not-a-version")).toThrow();
    expect(() => nodeMajor("v18.0.0")).not.toThrow();
    const after = process.versions.node;
    expect(after).toBe(before);
  });
});
