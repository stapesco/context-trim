/**
 * File discovery and filtering for the context-trim CLI.
 *
 * Walks a directory tree, applies .gitignore patterns, skips binaries,
 * lockfiles, and oversized files. Returns the canonical file list.
 */

import { readdir, stat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, basename } from "node:path";
import createIgnore from "ignore";

export interface ScanOptions {
  root: string;
  maxFileBytes: number;
  followSymlinks: boolean;
}

export interface ScannedFile {
  path: string;        // absolute
  relPath: string;     // relative to root, forward slashes
  size: number;        // bytes
  lines: number;       // line count (newline-delimited)
}

const DEFAULT_MAX_FILE_BYTES = 200 * 1024; // 200 KB
const BINARY_SAMPLE_BYTES = 8192;

/**
 * Patterns we always exclude regardless of .gitignore.
 * Lockfiles are noise. Common dependency directories are noise.
 * VCS internals are noise. Minified blobs are noise.
 */
const ALWAYS_EXCLUDE: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.hg(\/|$)/,
  /(^|\/)\.svn(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.nuxt(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.playwright-mcp(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)target(\/|$)/,            // rust
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)vendor(\/|$)/,            // php, go
];

const LOCKFILE_NAMES: Set<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
]);

/**
 * File extensions we treat as text. Anything not here is binary and skipped.
 * We do NOT trust the extension blindly — binary sniff via first 8KB.
 */
const TEXT_EXT_HINT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini",
  ".md", ".mdx", ".txt", ".rst", ".adoc",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".gql",
  ".xml", ".svg", ".vue", ".svelte", ".astro",
  ".env.example", ".gitignore", ".gitattributes", ".editorconfig",
  ".dockerfile", "Dockerfile", ".containerfile", "Containerfile",
]);

/** Check whether file content is binary by sniffing the first bytes for NUL. */
function isBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, BINARY_SAMPLE_BYTES));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

/** Recursive directory walk. Yields absolute paths. */
async function* walk(dir: string, root: string, followSymlinks: boolean): AsyncGenerator<string> {
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink() && !followSymlinks) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      // For symlinks (with followSymlinks enabled), stat the target and dispatch.
      if (entry.isSymbolicLink()) {
        try {
          const realTarget = await stat(full); // follows symlinks
          // SECURITY: only follow if the *resolved* target stays inside root.
          // Without this check, a symlink at `work/evil.ts -> /etc/passwd`
          // would dump /etc/passwd into the digest.
          const resolved = await realpath(full);
          if (!isInsideRoot(resolved, root)) continue;
          if (realTarget.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (realTarget.isFile()) {
            yield full;
            continue;
          }
        } catch {
          continue;
        }
      }
      if (entry.isFile()) {
        yield full;
      }
    }
  }
}

/**
 * Lexical check whether `path` is `root` or below it. Both arguments must
 * already be canonicalised (realpath-resolved) — typically the caller has
 * just resolved them. This avoids the macOS `/var -> /private/var` trap.
 */
function isInsideRoot(path: string, root: string): boolean {
  const a = path.replace(/\/$/, "");
  const b = root.replace(/\/$/, "");
  if (a === b) return true;
  return a.startsWith(b + "/");
}

/**
 * Resolve a root path to its canonical (symlink-resolved) absolute form.
 * Falls back to plain resolve() if realpath fails (e.g. the path doesn't
 * exist yet). On macOS this is what avoids `/var` vs `/private/var`
 * mismatches during symlink-scope checks.
 */
async function canonicalRoot(p: string): Promise<string> {
  const resolved = resolve(p);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

/** Load .gitignore from the root if present. Returns an "ignore" instance. */
async function loadGitignore(root: string) {
  const ig = createIgnore();
  const gitignorePath = join(root, ".gitignore");
  try {
    const content = await readFile(gitignorePath, "utf8");
    ig.add(content);
  } catch {
    // No .gitignore — fine, we'll just skip our ALWAYS_EXCLUDE patterns.
  }
  return ig;
}

export async function scan(options: ScanOptions): Promise<ScannedFile[]> {
  const root = await canonicalRoot(options.root);
  const maxBytes = options.maxFileBytes > 0 ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  const ig = await loadGitignore(root);

  const out: ScannedFile[] = [];

  for await (const abs of walk(root, root, options.followSymlinks)) {
    const rel = relative(root, abs);
    const relPosix = rel.split("\\").join("/");

    // Always-exclude patterns
    let excluded = false;
    for (const pat of ALWAYS_EXCLUDE) {
      if (pat.test(relPosix)) { excluded = true; break; }
    }
    if (excluded) continue;

    // .gitignore
    if (ig.ignores(relPosix)) continue;

    // Lockfile names — skip regardless of gitignore
    if (LOCKFILE_NAMES.has(basename(relPosix))) continue;

    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    if (s.size === 0) continue; // empty files are noise
    if (s.size > maxBytes) continue;

    // Extension hint: skip obviously binary extensions to avoid the
    // open+sniff cost on the bulk of files.
    const dotIdx = relPosix.lastIndexOf(".");
    const ext = dotIdx >= 0 ? relPosix.substring(dotIdx).toLowerCase() : "";
    const base = basename(relPosix);
    const looksText = TEXT_EXT_HINT.has(ext) || TEXT_EXT_HINT.has(base);
    if (!looksText) continue;

    // Binary sniff — read first 8KB.
    let fd;
    try {
      fd = await readFile(abs);
    } catch {
      continue;
    }
    if (isBinaryBuffer(fd)) continue;

    const lines = countLines(fd.toString("utf8"));
    out.push({
      path: abs,
      relPath: relPosix,
      size: s.size,
      lines,
    });
  }

  // Sort by relative path for deterministic output.
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

/** Count newline-terminated lines. Works for both LF and CRLF. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  // Trailing content after the last newline counts as one line.
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}