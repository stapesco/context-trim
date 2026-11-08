import { describe, it, expect } from "vitest";
import {
  assertNodeVersion,
  isSupportedVersion,
  MIN_NODE_VERSION,
  nodeMajor,
  parseNodeVersion,
} from "../src/node-check.js";

describe("assertNodeVersion", () => {
  it("does not exit when running on a supported Node", () => {
    // The test runner itself must be on a supported runtime, otherwise the
    // suite could not have loaded. Assert the floor is satisfied.
    expect(isSupportedVersion(process.versions.node)).toBe(true);
    expect(() => assertNodeVersion()).not.toThrow();
  });
});

describe("MIN_NODE_VERSION", () => {
  it("is the documented floor of 22.12.0", () => {
    expect(MIN_NODE_VERSION).toEqual([22, 12, 0]);
  });
});

describe("isSupportedVersion", () => {
  it("accepts the exact floor version", () => {
    expect(isSupportedVersion("22.12.0")).toBe(true);
    expect(isSupportedVersion("v22.12.0")).toBe(true);
  });

  it("rejects a version below the floor on the same major", () => {
    expect(isSupportedVersion("22.11.0")).toBe(false);
    expect(isSupportedVersion("22.0.0")).toBe(false);
    expect(isSupportedVersion("22.11.99")).toBe(false);
  });

  it("rejects an older major version", () => {
    expect(isSupportedVersion("20.0.0")).toBe(false);
    expect(isSupportedVersion("18.17.1")).toBe(false);
    expect(isSupportedVersion("16.20.0")).toBe(false);
  });

  it("accepts a newer major version", () => {
    expect(isSupportedVersion("24.0.0")).toBe(true);
    expect(isSupportedVersion("26.13.0")).toBe(true);
    expect(isSupportedVersion("30.0.0")).toBe(true);
  });

  it("treats a missing minor or patch as zero", () => {
    // "22" is below the floor because the minor defaults to 0.
    expect(isSupportedVersion("22")).toBe(false);
    expect(isSupportedVersion("24")).toBe(true);
  });

  it("throws on an unparseable version rather than assuming support", () => {
    expect(() => isSupportedVersion("not-a-version")).toThrow();
    expect(() => isSupportedVersion("")).toThrow();
  });
});

describe("parseNodeVersion", () => {
  it("splits a version into major, minor, and patch", () => {
    expect(parseNodeVersion("22.12.0")).toEqual({ major: 22, minor: 12, patch: 0 });
    expect(parseNodeVersion("v24.22.2")).toEqual({ major: 24, minor: 22, patch: 2 });
  });

  it("defaults a missing minor or patch to zero", () => {
    expect(parseNodeVersion("22")).toEqual({ major: 22, minor: 0, patch: 0 });
    expect(parseNodeVersion("22.12")).toEqual({ major: 22, minor: 12, patch: 0 });
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
