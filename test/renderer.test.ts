import { describe, it, expect } from "vitest";
import { renderDigest } from "../src/renderer.js";
import type { ScannedFile } from "../src/scanner.js";

function mkFile(rel: string, size: number, lines: number): ScannedFile {
  return { path: `/tmp/${rel}`, relPath: rel, size, lines };
}

describe("renderDigest: header", () => {
  it("includes the title, root, file count, and total bytes", async () => {
    const files = [mkFile("a.ts", 10, 2)];
    const result = await renderDigest(
      files,
      async () => "hello\n",
      { title: "T", root: "/root", totalBytes: 10, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    expect(result.markdown).toContain("# T");
    expect(result.markdown).toContain("Root: `/root`");
    expect(result.markdown).toContain("Files: 1");
    expect(result.markdown).toContain("Bytes: 10");
  });
});

describe("renderDigest: file sections", () => {
  it("wraps each file body in a fenced code block", async () => {
    const files = [mkFile("a.ts", 5, 1), mkFile("b.ts", 5, 1)];
    const result = await renderDigest(
      files,
      async (abs) => abs.endsWith("a.ts") ? "AAA\n" : "BBB\n",
      { title: "T", root: "/r", totalBytes: 10, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    expect(result.markdown).toContain("## a.ts");
    expect(result.markdown).toContain("```\nAAA\n```");
    expect(result.markdown).toContain("## b.ts");
    expect(result.markdown).toContain("```\nBBB\n```");
  });
});

describe("renderDigest: per-file truncation", () => {
  it("truncates file bodies exceeding the per-file limit", async () => {
    const longBody = "x".repeat(200);
    const files = [mkFile("long.ts", 200, 1)];
    const result = await renderDigest(
      files,
      async () => longBody,
      { title: "T", root: "/r", totalBytes: 200, perFileCharLimit: 50, totalCharLimit: 10000 },
    );
    expect(result.truncatedFiles).toEqual(["long.ts"]);
    // Section format: "## long.ts\n```\n<body>\n```\n\n"  (header join adds an extra \n).
    // The body sits between the open fence's \n and the close fence's \n```.
    const sectionStart = result.markdown.indexOf("## long.ts");
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    const fenceOpenEnd = result.markdown.indexOf("```\n", sectionStart) + 4;
    // Closing fence: find "```\n" starting after the body content. With body=50 chars,
    // the close fence starts at fenceOpenEnd + 50.
    const fenceCloseStart = result.markdown.indexOf("```\n", fenceOpenEnd + 50);
    expect(fenceCloseStart).toBeGreaterThanOrEqual(0);
    const body = result.markdown.substring(fenceOpenEnd, fenceCloseStart);
    expect(body.length).toBe(50);
    expect(body).toBe("x".repeat(50));
  });
});

describe("renderDigest: total limit", () => {
  it("stops emitting once total limit is hit", async () => {
    const files = Array.from({ length: 50 }, (_, i) => mkFile(`f${i}.ts`, 1000, 50));
    const result = await renderDigest(
      files,
      async () => "line\n".repeat(50),
      { title: "T", root: "/r", totalBytes: 50000, perFileCharLimit: 1000, totalCharLimit: 2000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain("End of digest");
    // Should have stopped before the last file
    expect(result.markdown).not.toContain("## f49.ts");
  });
});