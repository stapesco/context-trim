import { describe, it, expect } from "vitest";
import { renderDigest, longestBacktickRun } from "../src/renderer.js";
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

describe("renderDigest: fence selection", () => {
  it("uses a 4-backtick fence when the body contains ``` blocks", async () => {
    const body = "before\n```js\nconsole.log('inside fence');\n```\nafter\n";
    const files = [mkFile("nested.md", body.length, 5)];
    const result = await renderDigest(
      files,
      async () => body,
      { title: "T", root: "/r", totalBytes: body.length, perFileCharLimit: 10000, totalCharLimit: 100000 },
    );
    // The outer fence must be longer than the embedded ```` run.
    // The body contains `````` runs (3 backticks). Outer fence should be 4+.
    const afterHeader = result.markdown.split("## nested.md\n")[1] ?? "";
    expect(afterHeader.startsWith("````\n")).toBe(true);
    // Closing fence must match the opening fence (4 backticks).
    const closeIdx = afterHeader.lastIndexOf("\n````\n");
    expect(closeIdx).toBeGreaterThanOrEqual(0);
  });

  it("uses a 5-backtick fence when the body contains ````` runs", async () => {
    const body = "before\n`````js\ninside\n`````\nafter\n";
    const files = [mkFile("nested2.md", body.length, 5)];
    const result = await renderDigest(
      files,
      async () => body,
      { title: "T", root: "/r", totalBytes: body.length, perFileCharLimit: 10000, totalCharLimit: 100000 },
    );
    const afterHeader = result.markdown.split("## nested2.md\n")[1] ?? "";
    // Body has a 5-backtick run; outer fence should be 6+.
    expect(afterHeader.startsWith("``````\n")).toBe(true);
  });

  it("never produces an outer fence shorter than 3 backticks", async () => {
    const body = "no backticks at all\n";
    const files = [mkFile("plain.md", body.length, 2)];
    const result = await renderDigest(
      files,
      async () => body,
      { title: "T", root: "/r", totalBytes: body.length, perFileCharLimit: 10000, totalCharLimit: 100000 },
    );
    const afterHeader = result.markdown.split("## plain.md\n")[1] ?? "";
    expect(afterHeader.startsWith("```\n")).toBe(true);
  });
});

describe("longestBacktickRun", () => {
  it("returns 0 for empty input", () => {
    expect(longestBacktickRun("")).toBe(0);
  });
  it("returns 0 for text with no backticks", () => {
    expect(longestBacktickRun("plain text\nmore text")).toBe(0);
  });
  it("counts the longest run", () => {
    expect(longestBacktickRun("` `` ``` ```` `````")).toBe(5);
  });
  it("handles backticks at the end", () => {
    expect(longestBacktickRun("text ````")).toBe(4);
  });
});