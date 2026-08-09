import { describe, it, expect } from "vitest";
import { assertNodeVersion } from "../src/node-check.js";

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