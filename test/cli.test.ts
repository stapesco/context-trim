import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { PROGRAM_VERSION } from "../src/version";

const CLI_PATH = resolve(__dirname, "../dist/cli.js");

interface CliSpawnResult {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}

async function runCli(args: string[], options: { cwd?: string } = {}): Promise<CliSpawnResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        status,
        signal,
      });
    });
  });
}

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "sct-cli-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeFixture(rel: string, content: string | Buffer): Promise<void> {
  const full = join(work, rel);
  const dir = full.substring(0, full.lastIndexOf("/"));
  if (dir !== work && dir.length > 0) await mkdir(dir, { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("CLI: --json schema (contract)", () => {
  it("emits all required keys plus fileList and a trailing newline", async () => {
    await writeFixture("keep.ts", "export const a = 1;\n");
    await writeFixture("ignored.ts", "drop\n");
    await writeFixture("package-lock.json", "{}\n");
    await writeFixture("large.ts", "x".repeat(500));
    await writeFixture("binary.ts", Buffer.from([0x61, 0x00, 0x62]));
    await writeFixture("empty.ts", "");
    await writeFixture(".gitignore", "ignored.ts\n");

    const result = await runCli([work, "--json", "--max-file-bytes", "100"]);

    expect(result.status).toBe(0);
    // Newline-terminated JSON, parseable.
    expect(result.stdout.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(result.stdout);

    // Required keys (from the spec).
    expect(parsed).toHaveProperty("tool");
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("root");
    expect(parsed).toHaveProperty("fileCount");
    expect(parsed).toHaveProperty("totalBytes");
    expect(parsed).toHaveProperty("elapsedMs");
    expect(parsed).toHaveProperty("skipped");
    expect(parsed).toHaveProperty("fileList");

    expect(parsed.tool).toBe("stapes-context-trim");
    expect(parsed.fileCount).toBe(2);
    expect(parsed.totalBytes).toBeGreaterThan(0);
    expect(parsed.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(parsed.skipped).toEqual({
      binary: 1,
      lockfile: 1,
      tooLarge: 1,
      gitignored: 1,
      unsupportedType: 0,
      empty: 1,
      excluded: 0,
    });

    // fileList carries the kept files with the per-file metadata.
    expect(Array.isArray(parsed.fileList)).toBe(true);
    expect(parsed.fileList.length).toBe(2);
    const relPaths = parsed.fileList.map((f: { path: string }) => f.path).sort();
    expect(relPaths).toEqual([".gitignore", "keep.ts"]);
    for (const entry of parsed.fileList) {
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("size");
      expect(entry).toHaveProperty("lines");
    }

    // The legacy `durationMs` field must be ABSENT — `elapsedMs` is the contract.
    expect(parsed).not.toHaveProperty("durationMs");
  });

  it("emits the canonical root (realpath) in the JSON output", async () => {
    await writeFixture("a.ts", "x\n");
    const result = await runCli([work, "--json"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.root).toBe(await realpath(work));
  });

  it("writes identical newline-terminated JSON to --out", async () => {
    await writeFixture("one.ts", "x\n");
    await writeFixture("two.ts", "y\n");
    const outPath = join(work, "out.json");

    const result = await runCli([work, "--json", "--out", outPath, "--max-file-bytes", "100"]);
    expect(result.status).toBe(0);
    const stdout = result.stdout;
    // --out mode writes to file only; stdout should be empty.
    expect(stdout).toBe("");

    const fromFile = await readFile(outPath, "utf8");
    expect(fromFile.endsWith("\n")).toBe(true);
    const parsedFile = JSON.parse(fromFile);
    expect(parsedFile).toHaveProperty("fileList");
    expect(parsedFile.fileCount).toBe(2);
  });
});

describe("CLI: invalid scan path", () => {
  it("exits 1 with a message when the scan path does not exist", async () => {
    const result = await runCli([join(work, "does-not-exist"), "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/scan path does not exist/);
    // A failed run must not emit a JSON summary that looks like a clean scan.
    expect(result.stdout).toBe("");
  });

  it("exits 1 with a message when the scan path is a file", async () => {
    await writeFixture("a.ts", "x\n");
    const result = await runCli([join(work, "a.ts"), "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/scan path is not a directory/);
    expect(result.stdout).toBe("");
  });

  it("exits 1 in markdown mode too", async () => {
    const result = await runCli([join(work, "does-not-exist")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/scan path does not exist/);
  });
});

describe("CLI: --out does not scan its own output", () => {
  it("keeps the digest the same size across repeated runs", async () => {
    await writeFixture("a.ts", "export const a = 1;\n");
    const outPath = join(work, "ctx.md");

    const first = await runCli([work, "--out", outPath]);
    expect(first.status).toBe(0);
    const firstSize = (await readFile(outPath)).byteLength;

    const second = await runCli([work, "--out", outPath]);
    expect(second.status).toBe(0);
    const secondSize = (await readFile(outPath)).byteLength;

    // Before the fix the digest absorbed its own previous output and grew
    // with every run.
    expect(secondSize).toBe(firstSize);
  });

  it("excludes the --out target from the scanned file list", async () => {
    await writeFixture("a.ts", "export const a = 1;\n");
    // A previous digest is already sitting in the scan root.
    await writeFixture("ctx.md", "# previous digest\n");

    const result = await runCli([work, "--json", "--out", join(work, "summary.json")]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(await readFile(join(work, "summary.json"), "utf8"));
    const paths = parsed.fileList.map((f: { path: string }) => f.path);
    // The --out target is never scanned, so it never appears in the summary.
    expect(paths).not.toContain("summary.json");
  });
});

describe("CLI: strict numeric flag parsing", () => {
  it("rejects non-numeric --max-file-bytes with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-file-bytes", "abc", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-file-bytes/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects zero --max-file-bytes with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-file-bytes", "0", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-file-bytes/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects negative --max-file-bytes with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-file-bytes", "-5", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-file-bytes/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects non-numeric --per-file-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--per-file-chars", "abc", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--per-file-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects zero --per-file-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--per-file-chars", "0", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--per-file-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects negative --per-file-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--per-file-chars", "-1", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--per-file-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects non-numeric --max-total-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-total-chars", "abc", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-total-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects zero --max-total-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-total-chars", "0", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-total-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects negative --max-total-chars with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-total-chars", "-1", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-total-chars/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects decimal --max-file-bytes with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-file-bytes", "1.5", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-file-bytes/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });

  it("rejects hex --max-file-bytes with exit 1 and an option error", async () => {
    const result = await runCli([work, "--max-file-bytes", "0x10", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--max-file-bytes/);
    expect(result.stderr.toLowerCase()).toContain("option");
  });
});

describe("CLI: package metadata", () => {
  it("package.json version matches the single source of truth", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf8"),
    ) as { version: string; main?: string; bin: Record<string, string> };
    expect(pkg.version).toBe(PROGRAM_VERSION);
    expect(pkg.bin["stapes-context-trim"]).toBe("dist/cli.js");
    expect(pkg.main).toBeUndefined();
  });

  it("emits the package.json version in the JSON summary", async () => {
    await writeFixture("only.ts", "x\n");
    const result = await runCli([work, "--json"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.version).toBe(PROGRAM_VERSION);
  });
});
