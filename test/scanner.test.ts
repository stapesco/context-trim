import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, countLines } from "../src/scanner.js";

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "sct-scanner-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function write(rel: string, content: string | Buffer): Promise<void> {
  const full = join(work, rel);
  const dir = full.substring(0, full.lastIndexOf("/"));
  if (dir !== work) await mkdir(dir, { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("scan: basic discovery", () => {
  it("finds text files at the root", async () => {
    await write("a.ts", "export const a = 1;\n");
    await write("b.txt", "hello\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    const rels = files.map((f) => f.relPath).sort();
    expect(rels).toEqual(["a.ts", "b.txt"]);
  });

  it("walks nested directories", async () => {
    await write("src/cli.ts", "console.log('hi');\n");
    await write("src/util/util.ts", "export const x = 1;\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath).sort()).toEqual(["src/cli.ts", "src/util/util.ts"]);
  });
});

describe("scan: .gitignore", () => {
  it("respects .gitignore patterns", async () => {
    await write(".gitignore", "build/\n*.log\n");
    await write("keep.ts", "ok\n");
    await write("build/artifact.js", "drop me\n");
    await write("debug.log", "drop me too\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath).sort()).toEqual([".gitignore", "keep.ts"]);
  });
});

describe("scan: always-excluded paths", () => {
  it("skips node_modules, .git, dist, target", async () => {
    await write("src/index.ts", "ok\n");
    await write("node_modules/lib/index.js", "drop\n");
    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write("dist/bundle.js", "drop\n");
    await write("target/release/binary", "drop\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["src/index.ts"]);
  });
});

describe("scan: lockfiles", () => {
  it("skips lockfiles by basename", async () => {
    await write("package.json", "{}\n");
    await write("package-lock.json", "{}\n");
    await write("yarn.lock", "lock\n");
    await write("Cargo.lock", "lock\n");
    await write("uv.lock", "lock\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["package.json"]);
  });
});

describe("scan: binary detection", () => {
  it("skips files whose first 8KB contains a NUL byte", async () => {
    await write("image.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await write("text.md", "hello\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["text.md"]);
  });
});

describe("scan: max file bytes", () => {
  it("skips files larger than the configured limit", async () => {
    await write("small.ts", "x\n");
    await write("big.ts", "x".repeat(500));
    const files = await scan({ root: work, maxFileBytes: 100, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["small.ts"]);
  });
});

describe("scan: empty files", () => {
  it("skips zero-byte files", async () => {
    await write("empty.ts", "");
    await write("notempty.ts", "x\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["notempty.ts"]);
  });
});

describe("scan: deterministic ordering", () => {
  it("returns results sorted by relative path", async () => {
    await write("z.ts", "z\n");
    await write("a.ts", "a\n");
    await write("m.ts", "m\n");
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });
});

describe("scan: symlink handling", () => {
  it("does not follow symlinks by default", async () => {
    await write("real.ts", "real\n");
    await symlink(join(work, "real.ts"), join(work, "link.ts"));
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    // Only `real.ts` — the symlink is excluded.
    expect(files.map((f) => f.relPath)).toEqual(["real.ts"]);
  });

  it("follows symlinks when --follow-symlinks is true", async () => {
    await write("real.ts", "real\n");
    await symlink(join(work, "real.ts"), join(work, "link.ts"));
    const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
    expect(files.map((f) => f.relPath).sort()).toEqual(["link.ts", "real.ts"]);
  });

  it("does not follow symlinks that escape the root (file)", async () => {
    // Create a target file outside the work dir.
    const outside = join(tmpdir(), `sct-outside-${Date.now()}.ts`);
    await writeFile(outside, "secret\n", "utf8");
    try {
      await symlink(outside, join(work, "evil.ts"));
      const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
      // The escaped symlink must NOT appear in the output.
      expect(files.map((f) => f.relPath)).not.toContain("evil.ts");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("does not follow symlinks that escape the root (directory)", async () => {
    // Create an outside directory with a file inside.
    const outsideDir = join(tmpdir(), `sct-outdir-${Date.now()}`);
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.ts"), "secret\n", "utf8");
    try {
      await symlink(outsideDir, join(work, "evil-link"));
      const files = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
      // The escaped directory must NOT contribute files.
      expect(files.map((f) => f.relPath)).not.toContain("evil-link/secret.ts");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("countLines", () => {
  it("counts LF-delimited lines", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("")).toBe(0);
    expect(countLines("single")).toBe(1);
  });
  it("counts CRLF-delimited lines", () => {
    expect(countLines("a\r\nb\r\nc\r\n")).toBe(3);
  });
});