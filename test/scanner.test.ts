import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, countLines, comparePaths } from "../src/scanner.js";

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
  it("returns the canonical root and exact public skip counts", async () => {
    await write("keep.ts", "ok\n");
    await write("ignored.ts", "ignored\n");
    await write("package-lock.json", "lock\n");
    await write("large.ts", "x".repeat(200));
    await write("binary.ts", Buffer.from([0x61, 0x00, 0x62]));
    await write("empty.ts", "");
    await write("unknown.data", "text\n");
    await write(".gitignore", "ignored.ts\n");

    const result = await scan({ root: work, maxFileBytes: 100, followSymlinks: false });

    expect(result.root).toBe(await realpath(work));
    expect(result.files.map((file) => file.relPath)).toEqual([".gitignore", "keep.ts"]);
    expect(result.skipped).toEqual({
      binary: 1,
      lockfile: 1,
      tooLarge: 1,
      gitignored: 1,
      unsupportedType: 1,
      empty: 1,
      excluded: 0,
    });
  });

  it("finds text files at the root", async () => {
    await write("a.ts", "export const a = 1;\n");
    await write("b.txt", "hello\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    const rels = files.map((f) => f.relPath).sort();
    expect(rels).toEqual(["a.ts", "b.txt"]);
  });

  it("walks nested directories", async () => {
    await write("src/cli.ts", "console.log('hi');\n");
    await write("src/util/util.ts", "export const x = 1;\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath).sort()).toEqual(["src/cli.ts", "src/util/util.ts"]);
  });
});

describe("scan: .gitignore", () => {
  it("applies nested .gitignore rules and local negations", async () => {
    await write(".gitignore", "root-only.log\n");
    await write("root-only.log", "drop\n");
    await write("packages/app/.gitignore", "*.ts\n!keep.ts\n");
    await write("packages/app/ignored.ts", "drop\n");
    await write("packages/app/keep.ts", "keep\n");

    const { files, skipped } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    expect(files.map((file) => file.relPath)).toEqual([".gitignore", "packages/app/.gitignore", "packages/app/keep.ts"]);
    expect(skipped.gitignored).toBe(2);
  });
});

describe("scan: always-excluded paths", () => {
  it("skips build output and explicit minified filenames", async () => {
    await write("src/index.ts", "ok\n");
    await write("node_modules/lib/index.js", "drop\n");
    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write("dist/bundle.js", "drop\n");
    await write("target/release/binary", "drop\n");
    await write("out/generated.ts", "drop\n");
    await write("app.min.js", "drop\n");
    await write("style.min.css", "drop\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["src/index.ts"]);
  });

  it("includes common extensionless source basenames", async () => {
    for (const name of ["Makefile", "Procfile", "Justfile", "CMakeLists.txt"]) {
      await write(name, "source\n");
    }

    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    expect(files.map((file) => file.relPath)).toEqual(["CMakeLists.txt", "Justfile", "Makefile", "Procfile"]);
  });
});

describe("scan: lockfiles", () => {
  it("skips known lockfiles without treating arbitrary .lock files as lockfiles", async () => {
    await write("package.json", "{}\n");
    await write("package-lock.json", "{}\n");
    await write("yarn.lock", "lock\n");
    await write("Cargo.lock", "lock\n");
    await write("uv.lock", "lock\n");
    await write("custom.lock", "custom\n");
    const { files, skipped } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["package.json"]);
    expect(skipped.lockfile).toBe(4);
  });
});

describe("scan: binary detection", () => {
  it("skips files whose first 8KB contains a NUL byte", async () => {
    await write("image.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await write("text.md", "hello\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["text.md"]);
  });
});

describe("scan: max file bytes", () => {
  it("skips files larger than the configured limit", async () => {
    await write("small.ts", "x\n");
    await write("big.ts", "x".repeat(500));
    const { files } = await scan({ root: work, maxFileBytes: 100, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["small.ts"]);
  });
});

describe("scan: empty files", () => {
  it("skips zero-byte files", async () => {
    await write("empty.ts", "");
    await write("notempty.ts", "x\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["notempty.ts"]);
  });
});

describe("scan: deterministic ordering", () => {
  it("returns results sorted by relative path", async () => {
    await write("z.ts", "z\n");
    await write("a.ts", "a\n");
    await write("m.ts", "m\n");
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    expect(files.map((f) => f.relPath)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("orders by code unit, not by locale", async () => {
    // `localeCompare` sorted "Ärger.ts" before "zebra.ts" under a Swedish
    // locale but after it under the C locale. The `--json` contract promises
    // a stable shape, so the order must not depend on the machine locale.
    await write("zebra.ts", "z\n");
    await write("Ärger.ts", "a\n");
    await write("apple.ts", "a\n");

    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    const expected = ["apple.ts", "zebra.ts", "Ärger.ts"];
    expect(files.map((f) => f.relPath)).toEqual(expected);
  });
});

describe("comparePaths", () => {
  it("orders by UTF-16 code unit", () => {
    expect(comparePaths("a", "b")).toBe(-1);
    expect(comparePaths("b", "a")).toBe(1);
    expect(comparePaths("a", "a")).toBe(0);
  });

  it("is not locale-sensitive", () => {
    // Under a Swedish locale, "zebra" sorts before "Ärger" because "Ä" is
    // treated as A-with-ring and therefore sorts after "z". Code-unit order
    // puts "Ä" (U+00C4) last.
    expect(comparePaths("zebra.ts", "Ärger.ts")).toBe(-1);
  });
});

describe("scan: excluded paths", () => {
  it("omits paths listed in excludePaths", async () => {
    await write("keep.ts", "keep\n");
    await write("ctx.md", "# previous digest\n");

    const { files } = await scan({
      root: work,
      maxFileBytes: 1024,
      followSymlinks: false,
      excludePaths: [join(work, "ctx.md")],
    });

    expect(files.map((f) => f.relPath)).toEqual(["keep.ts"]);
  });

  it("omits an excluded path that does not exist yet", async () => {
    await write("keep.ts", "keep\n");

    const { files } = await scan({
      root: work,
      maxFileBytes: 1024,
      followSymlinks: false,
      excludePaths: [join(work, "not-created-yet.md")],
    });

    expect(files.map((f) => f.relPath)).toEqual(["keep.ts"]);
  });

  it("omits an excluded path given as a relative path", async () => {
    await write("keep.ts", "keep\n");
    await write("ctx.md", "# previous digest\n");

    const { files } = await scan({
      root: work,
      maxFileBytes: 1024,
      followSymlinks: false,
      excludePaths: ["ctx.md"],
    });

    expect(files.map((f) => f.relPath)).toEqual(["keep.ts"]);
  });
});

describe("scan: invalid root", () => {
  it("throws when the scan path does not exist", async () => {
    await expect(
      scan({ root: join(work, "does-not-exist"), maxFileBytes: 1024, followSymlinks: false }),
    ).rejects.toThrow(/scan path does not exist/);
  });

  it("throws when the scan path is a file rather than a directory", async () => {
    await write("a.ts", "x\n");
    await expect(
      scan({ root: join(work, "a.ts"), maxFileBytes: 1024, followSymlinks: false }),
    ).rejects.toThrow(/scan path is not a directory/);
  });
});

describe("scan: skip counters cover every drop reason", () => {
  it("counts files dropped for an unsupported type", async () => {
    await write("keep.ts", "ok\n");
    await write("data.unknown", "text\n");

    const { skipped } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    expect(skipped.unsupportedType).toBe(1);
  });

  it("counts files dropped because they are empty", async () => {
    await write("keep.ts", "ok\n");
    await write("empty.ts", "");

    const { skipped } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    expect(skipped.empty).toBe(1);
  });

  it("counts files dropped by the always-excluded rules", async () => {
    await write("keep.ts", "ok\n");
    await write("node_modules/lib/index.js", "drop\n");
    await write("dist/bundle.js", "drop\n");

    const { skipped } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });

    expect(skipped.excluded).toBe(2);
  });

  it("accounts for every file the scan did not return", async () => {
    await write("keep.ts", "ok\n");
    await write("empty.ts", "");
    await write("data.unknown", "text\n");
    await write("package-lock.json", "{}\n");
    await write("node_modules/lib/index.js", "drop\n");
    await write("big.ts", "x".repeat(500));
    await write(".gitignore", "ignored.ts\n");
    await write("ignored.ts", "drop\n");

    const { files, skipped } = await scan({
      root: work,
      maxFileBytes: 100,
      followSymlinks: false,
    });

    const accounted =
      files.length +
      skipped.binary +
      skipped.lockfile +
      skipped.tooLarge +
      skipped.gitignored +
      skipped.unsupportedType +
      skipped.empty +
      skipped.excluded;

    // Every file written above is either returned or counted once.
    expect(accounted).toBe(8);
  });
});

describe("scan: symlink handling", () => {
  it("does not follow symlinks by default", async () => {
    await write("real.ts", "real\n");
    await symlink(join(work, "real.ts"), join(work, "link.ts"));
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: false });
    // Only `real.ts` — the symlink is excluded.
    expect(files.map((f) => f.relPath)).toEqual(["real.ts"]);
  });

  it("follows symlinks when --follow-symlinks is true", async () => {
    await write("real.ts", "real\n");
    await symlink(join(work, "real.ts"), join(work, "link.ts"));
    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
    expect(files.map((f) => f.relPath).sort()).toEqual(["link.ts", "real.ts"]);
  });

  it("stops an in-root directory symlink cycle", async () => {
    await write("src/real.ts", "real\n");
    await symlink(work, join(work, "src", "ancestor"));

    const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });

    expect(files.map((file) => file.relPath)).toEqual(["src/real.ts"]);
  });

  it("does not follow symlinks that escape the root (file)", async () => {
    // Create a target file outside the work dir.
    const outside = join(tmpdir(), `sct-outside-${Date.now()}.ts`);
    await writeFile(outside, "secret\n", "utf8");
    try {
      await symlink(outside, join(work, "evil.ts"));
      const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
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
      const { files } = await scan({ root: work, maxFileBytes: 1024, followSymlinks: true });
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