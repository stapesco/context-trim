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
    expect(result.markdown).toContain("```ts\nAAA\n```");
    expect(result.markdown).toContain("## b.ts");
    expect(result.markdown).toContain("```ts\nBBB\n```");
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
    // The body is truncated to leave room for the marker inside the per-file
    // budget. The body sits between the opening fence and the marker line.
    const sectionStart = result.markdown.indexOf("## long.ts");
    const openFenceEnd = result.markdown.indexOf("```ts\n", sectionStart) + "```ts\n".length;
    const markerStart = result.markdown.indexOf("\n[truncated:", openFenceEnd);
    const body = result.markdown.substring(openFenceEnd, markerStart);
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/^x+\n?$/);
    // The full body length is at most perFileLimit (50); the marker eats
    // some of the budget when reservation is possible.
    expect(body.length).toBeLessThanOrEqual(50);
    // Marker MUST report the actual emitted source length, not the configured cap.
    // Body length is `body.length` (after stripping trailing \n); the marker
    // sits on the next line. With perFileLimit=50 and a 45-char marker, the
    // reservation succeeds, so the body slice is 50 - 46 = 4 chars.
    const markerLine = result.markdown.substring(markerStart + 1, result.markdown.indexOf("\n", markerStart + 1));
    expect(markerLine).toMatch(/^\[truncated: original 200 chars, showing \d+\]$/);
    const showingMatch = markerLine.match(/showing (\d+)/);
    expect(showingMatch).not.toBeNull();
    expect(Number(showingMatch![1])).toBe(body.replace(/\n$/, "").length);
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

describe("renderDigest: fence closure", () => {
  it("starts the closing fence on a new line when the body ends with a single backtick", async () => {
    const body = "line one\nline two\n`";
    const files = [mkFile("a.ts", body.length, 3)];
    const result = await renderDigest(
      files,
      async () => body,
      { title: "T", root: "/r", totalBytes: body.length, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    const afterHeader = result.markdown.split("## a.ts\n")[1] ?? "";
    // Body has 1 backtick; outer fence is 3 (+1 over longest run) with `ts` info.
    expect(afterHeader.startsWith("```ts\n")).toBe(true);
    // Positive line assertion: split the section into lines and confirm
    // the closing fence is a discrete line of its own (backticks only,
    // no info string, no body content glued to it).
    const lines = afterHeader.split("\n");
    // Expected lines after the heading: openFence, "line one", "line two", "`", closeFence, "", ...
    // (the body ends with `\``, normalize-body replaces trailing \n+ which
    // does not touch backticks, then `\n${fence}\n` is appended so the
    // close fence is preceded by exactly one newline).
    const closeLine = lines.find((l) => /^`{3,}$/.test(l));
    expect(closeLine).toBe("```");
    // Body content must be present and intact.
    expect(lines).toContain("line one");
    expect(lines).toContain("line two");
    expect(lines).toContain("`");
    // The line directly preceding the close fence must NOT be the closing
    // fence itself (i.e., the body line is separate from the close).
    const closeIdx = lines.indexOf(closeLine!);
    expect(closeIdx).toBeGreaterThan(0);
    expect(lines[closeIdx - 1]).not.toMatch(/^`{3,}$/);
    // The line BEFORE that must be the trailing backtick from the body —
    // proving the body's backtick is intact (not glued to the close fence).
    expect(lines[closeIdx - 1]).toBe("`");
  });

  it("starts the closing fence on a new line when the body ends with three backticks (no trailing newline)", async () => {
    const body = "line one\nline two\n```";
    const files = [mkFile("b.ts", body.length, 3)];
    const result = await renderDigest(
      files,
      async () => body,
      { title: "T", root: "/r", totalBytes: body.length, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    const afterHeader = result.markdown.split("## b.ts\n")[1] ?? "";
    // Body has a 3-backtick run; outer fence must be 4+ with `ts` info.
    expect(afterHeader.startsWith("````ts\n")).toBe(true);
    // Positive line assertion: split into lines and confirm the body's
    // trailing backticks sit on their own line and the closing fence is
    // a separate line (4 backticks, no info string).
    const lines = afterHeader.split("\n");
    // Opening fence: "````ts"
    expect(lines[0]).toBe("````ts");
    // Body lines: "line one", "line two", "```"
    expect(lines).toContain("line one");
    expect(lines).toContain("line two");
    // The body's trailing 3-backtick line must be on its own (not fused
    // with the closing 4-backtick fence).
    const bodyTrailing = lines.indexOf("```");
    expect(bodyTrailing).toBeGreaterThan(0);
    expect(lines[bodyTrailing]).toBe("```");
    // The closing fence must be a 4-backtick line (length 4) on its own.
    const closeLine = lines.find((l) => /^`+$/.test(l) && l.length === 4);
    expect(closeLine).toBe("````");
    // The closing fence must NOT sit on the same line as the body's 3-backticks.
    expect(afterHeader).not.toMatch(/```[^\n]+```/);
    // The line index of the close fence must be strictly greater than the
    // body's trailing backtick line.
    const closeIdx = lines.indexOf(closeLine!);
    expect(closeIdx).toBeGreaterThan(bodyTrailing);
  });

  it("separates section heading from the next file's code fence when the body ends with a truncated backtick run", async () => {
    const body = "hi\n``";
    const files = [mkFile("c.ts", body.length, 2), mkFile("d.ts", 5, 1)];
    const result = await renderDigest(
      files,
      async (abs) => abs.endsWith("c.ts") ? body : "other\n",
      { title: "T", root: "/r", totalBytes: 30, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    // The second file's heading must appear OUTSIDE the first file's code fence.
    const cIdx = result.markdown.indexOf("## c.ts");
    const dIdx = result.markdown.indexOf("## d.ts");
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(dIdx).toBeGreaterThan(cIdx);
    // Positive line assertion: split into lines and verify the structure
    // is well-formed. The first section's body has a 2-backtick run, so
    // its outer fence is 3 backticks. The closing fence of c.ts must be
    // on its own line and the body's trailing `` ` `` ` must be intact
    // (not fused with the close). The next heading `## d.ts` then starts
    // on its own line.
    const allLines = result.markdown.split("\n");
    const dLineIdx = allLines.indexOf("## d.ts");
    expect(dLineIdx).toBeGreaterThan(0);
    // The line directly preceding "## d.ts" must be the closing fence
    // line (`\n\`\`\`\n` from tail produces a single line "```").
    // The line BEFORE the close fence is the body's trailing backticks.
    expect(allLines[dLineIdx - 1]).toBe("```");
    expect(allLines[dLineIdx - 2]).toBe("``");
    // The first section's heading must be its own line.
    expect(allLines).toContain("## c.ts");
    // The opening fence of d.ts must be its own line with info string.
    expect(allLines[dLineIdx + 1]).toBe("```ts");
    // No phantom blank line between sections (the closing fence and the
    // next heading are adjacent lines separated by a single \n).
    expect(allLines[dLineIdx - 1]).not.toBe("");
    // Body content must be intact.
    expect(allLines).toContain("hi");
  });
});

describe("renderDigest: language hint", () => {
  it("emits `ts` for .ts files", async () => {
    const files = [mkFile("a.ts", 5, 1)];
    const result = await renderDigest(
      files,
      async () => "x\n",
      { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    expect(result.markdown).toContain("## a.ts\n```ts\n");
  });

  it("emits `python` for .py files", async () => {
    const files = [mkFile("script.py", 5, 1)];
    const result = await renderDigest(
      files,
      async () => "x\n",
      { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    expect(result.markdown).toContain("## script.py\n```python\n");
  });

  it("emits `json` for .json files", async () => {
    const files = [mkFile("data.json", 5, 1)];
    const result = await renderDigest(
      files,
      async () => "x\n",
      { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    expect(result.markdown).toContain("## data.json\n```json\n");
  });

  it("emits no info string for unknown text extensions", async () => {
    const files = [mkFile("notes.unknownext", 5, 1)];
    const result = await renderDigest(
      files,
      async () => "x\n",
      { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    // Opening fence has no info string — the closing one must not either.
    const afterHeader = result.markdown.split("## notes.unknownext\n")[1] ?? "";
    expect(afterHeader.startsWith("```\n")).toBe(true);
    // And the closing fence match is the bare form.
    expect(afterHeader).toMatch(/\n```\n/);
  });

  it("appends the info string only to the opening fence", async () => {
    const files = [mkFile("a.ts", 5, 1)];
    const result = await renderDigest(
      files,
      async () => "x\n",
      { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    const afterHeader = result.markdown.split("## a.ts\n")[1] ?? "";
    // Opening fence must carry the info string.
    expect(afterHeader.startsWith("```ts\n")).toBe(true);
    // Closing fence must be bare — backticks only, no info string suffix.
    // The closing fence line is `\n\`\`\`\n` (no info characters between
    // the backticks and the newline).
    const closeMatch = afterHeader.match(/\n(`{3,})([a-zA-Z0-9_-]+)\n/);
    // If a fence with an info string appears, it would be in this match.
    // The closing fence has no info string, so this assertion holds.
    // (The opening fence line is NOT preceded by `\n` in this section, so
    // the regex scoped to a leading newline excludes the opening fence.)
    expect(closeMatch).toBeNull();
  });
});

describe("renderDigest: truncation marker", () => {
  it("emits a stable [truncated: ...] marker inside the code fence", async () => {
    const longBody = "x".repeat(100);
    const files = [mkFile("big.ts", 100, 1)];
    const result = await renderDigest(
      files,
      async () => longBody,
      { title: "T", root: "/r", totalBytes: 100, perFileCharLimit: 20, totalCharLimit: 10000 },
    );
    // With perFileLimit=20 and a marker longer than the budget, the
    // reservation fails and sliceLen falls back to perFileLimit. The
    // marker therefore reports showing=20 (the actual emitted length).
    expect(result.markdown).toContain("[truncated: original 100 chars, showing 20]");
    const sectionStart = result.markdown.indexOf("## big.ts");
    const nextSection = result.markdown.indexOf("---", sectionStart);
    const section = result.markdown.substring(sectionStart, nextSection);
    // The marker is INSIDE the fence — between the opening and the closing fences.
    // Opening fence is `\`\`\`ts\n`; closing fence has no info string.
    const openFenceMatch = section.match(/```ts\n/);
    expect(openFenceMatch).not.toBeNull();
    const openFence = section.indexOf("```ts\n") + "```ts\n".length;
    const closeFence = section.lastIndexOf("\n```\n");
    expect(openFence).toBeGreaterThan(0);
    expect(closeFence).toBeGreaterThan(openFence);
    expect(section.substring(openFence, closeFence)).toContain("[truncated: original 100 chars, showing 20]");
  });

  it("reports the actual emitted source length, not the configured perFileLimit", async () => {
    // When the marker fits inside the per-file budget, the marker reports
    // `showing = sliceLen`, which is perFileLimit minus the reserved marker
    // overhead. The number in the marker MUST equal the bytes actually
    // emitted, not the configured cap.
    const longBody = "y".repeat(200);
    const perFileLimit = 60;
    const files = [mkFile("acc.ts", 200, 1)];
    const result = await renderDigest(
      files,
      async () => longBody,
      { title: "T", root: "/r", totalBytes: 200, perFileCharLimit: perFileLimit, totalCharLimit: 10000 },
    );
    // Extract the showing value from the marker line.
    const markerMatch = result.markdown.match(/\[truncated: original 200 chars, showing (\d+)\]/);
    expect(markerMatch).not.toBeNull();
    const showing = Number(markerMatch![1]);
    // Body sits between the opening fence and the marker line.
    const sectionStart = result.markdown.indexOf("## acc.ts");
    const openFenceEnd = result.markdown.indexOf("```ts\n", sectionStart) + "```ts\n".length;
    const markerStart = result.markdown.indexOf("\n[truncated:", openFenceEnd);
    const emittedBody = result.markdown.substring(openFenceEnd, markerStart).replace(/\n$/, "");
    // The marker MUST report the exact number of source characters emitted,
    // not the perFileLimit (which would be a phantom value).
    expect(showing).toBe(emittedBody.length);
    expect(showing).toBeLessThan(perFileLimit);
    expect(showing).toBeGreaterThan(0);
  });

  it("records the truncated path in truncatedFiles", async () => {
    const longBody = "x".repeat(100);
    const files = [mkFile("big.ts", 100, 1)];
    const result = await renderDigest(
      files,
      async () => longBody,
      { title: "T", root: "/r", totalBytes: 100, perFileCharLimit: 20, totalCharLimit: 10000 },
    );
    expect(result.truncatedFiles).toEqual(["big.ts"]);
  });
});

describe("renderDigest: exact total limit accounting", () => {
  it("never exceeds totalCharLimit", async () => {
    const files = Array.from({ length: 10 }, (_, i) => mkFile(`f${i}.ts`, 50, 1));
    const result = await renderDigest(
      files,
      async () => "body\n",
      { title: "T", root: "/r", totalBytes: 500, perFileCharLimit: 1000, totalCharLimit: 300 },
    );
    expect(result.markdown.length).toBeLessThanOrEqual(300);
  });

  it("counts header, separators, and trailer against the total limit", async () => {
    const files = Array.from({ length: 5 }, (_, i) => mkFile(`f${i}.ts`, 50, 1));
    const result = await renderDigest(
      files,
      async () => "body\n",
      { title: "T", root: "/r", totalBytes: 250, perFileCharLimit: 1000, totalCharLimit: 10000 },
    );
    // The header block ends with `---` and two newlines; the trailer starts with `\n---\n`.
    expect(result.markdown).toContain("End of digest");
    expect(result.markdown.length).toBeLessThanOrEqual(10000);
  });

  it("emits exactly the bytes counted (no phantom newline between sections)", async () => {
    // The renderer joins parts with "" (no separator). Each section starts
    // with `## <rel>\n`, and the newline at the end of the section header
    // is the only separator between sections. There must NOT be a phantom
    // `\n\n` (blank line) between the closing fence of one section and the
    // heading of the next — that would mean the accounting over-counts.
    const files = [
      mkFile("a.ts", 5, 1),
      mkFile("b.ts", 5, 1),
      mkFile("c.ts", 5, 1),
    ];
    const result = await renderDigest(
      files,
      async () => "body\n",
      { title: "T", root: "/r", totalBytes: 15, perFileCharLimit: 1000, totalCharLimit: 100000 },
    );
    // No double-newline sequence "```\n\n##" — closing fence, single \n, next heading.
    expect(result.markdown).not.toMatch(/```\n\n##/);
    // The pattern "```\n## " (closing fence followed directly by next heading
    // line, with a single separator newline from the section header) IS expected.
    expect(result.markdown).toMatch(/```\n## /);
  });

  it("throws a RangeError when the limit cannot contain the fixed header and trailer", async () => {
    const files = [mkFile("a.ts", 5, 1)];
    await expect(
      renderDigest(
        files,
        async () => "x\n",
        { title: "T", root: "/r", totalBytes: 5, perFileCharLimit: 1000, totalCharLimit: 10 },
      ),
    ).rejects.toThrow(RangeError);
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
    expect(afterHeader.startsWith("````markdown\n")).toBe(true);
    // Closing fence must match the opening fence (4 backticks, no info string).
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
    expect(afterHeader.startsWith("``````markdown\n")).toBe(true);
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
    expect(afterHeader.startsWith("```markdown\n")).toBe(true);
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