/**
 * File discovery and filtering for the context-trim CLI.
 *
 * Walks a directory tree, applies hierarchical .gitignore patterns, skips
 * binaries, lockfiles, and oversized files. Returns the canonical scan result.
 */

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import createIgnore from "ignore";

export interface ScanOptions {
  root: string;
  maxFileBytes: number;
  followSymlinks: boolean;
}

export interface ScannedFile {
  path: string;
  relPath: string;
  size: number;
  lines: number;
}

export interface SkipCounts {
  binary: number;
  lockfile: number;
  tooLarge: number;
  gitignored: number;
}

export interface ScanResult {
  root: string;
  files: ScannedFile[];
  skipped: SkipCounts;
}

interface IgnoreContext {
  baseRel: string;
  matcher: ReturnType<typeof createIgnore>;
}

interface WalkedFile {
  path: string;
  ignoreContexts: IgnoreContext[];
}

const DEFAULT_MAX_FILE_BYTES = 200 * 1024;
const BINARY_SAMPLE_BYTES = 8192;

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
  /(^|\/)target(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  /(^|\/)[^/]+\.min\.js$/i,
  /(^|\/)[^/]+\.min\.css$/i,
];

const LOCKFILE_NAMES = new Set([
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
  "Makefile", "Procfile", "Justfile", "CMakeLists.txt",
]);

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  for (let index = 0; index < sample.length; index++) {
    if (sample[index] === 0) return true;
  }
  return false;
}

async function loadIgnoreContext(directory: string, root: string): Promise<IgnoreContext | undefined> {
  try {
    const content = await readFile(join(directory, ".gitignore"), "utf8");
    return {
      baseRel: relative(root, directory).split("\\").join("/"),
      matcher: createIgnore().add(content),
    };
  } catch {
    return undefined;
  }
}

function contextPath(context: IgnoreContext, relPath: string): string | undefined {
  if (context.baseRel === "") return relPath;
  const prefix = `${context.baseRel}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : undefined;
}

function isGitignored(relPath: string, contexts: IgnoreContext[]): boolean {
  let ignored = false;
  for (const context of contexts) {
    const localPath = contextPath(context, relPath);
    if (localPath === undefined || localPath === "") continue;
    const result = context.matcher.test(localPath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

async function* walk(
  root: string,
  followSymlinks: boolean,
): AsyncGenerator<WalkedFile> {
  const stack: Array<{ directory: string; ignoreContexts: IgnoreContext[] }> = [
    { directory: root, ignoreContexts: [] },
  ];
  const visitedDirectories = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;

    let canonicalDirectory: string;
    try {
      canonicalDirectory = await realpath(current.directory);
    } catch {
      continue;
    }
    if (visitedDirectories.has(canonicalDirectory)) continue;
    visitedDirectories.add(canonicalDirectory);

    const localContext = await loadIgnoreContext(current.directory, root);
    const ignoreContexts = localContext === undefined
      ? current.ignoreContexts
      : [...current.ignoreContexts, localContext];

    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current.directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue;
        try {
          const resolved = await realpath(full);
          if (!isInsideRoot(resolved, root)) continue;
          const target = await stat(full);
          if (target.isDirectory()) {
            stack.push({ directory: full, ignoreContexts });
          } else if (target.isFile()) {
            yield { path: full, ignoreContexts };
          }
        } catch {
          continue;
        }
      } else if (entry.isDirectory()) {
        stack.push({ directory: full, ignoreContexts });
      } else if (entry.isFile()) {
        yield { path: full, ignoreContexts };
      }
    }
  }
}

function isInsideRoot(path: string, root: string): boolean {
  const candidate = path.replace(/\/$/, "");
  const canonicalRoot = root.replace(/\/$/, "");
  return candidate === canonicalRoot || candidate.startsWith(`${canonicalRoot}/`);
}

async function canonicalRoot(path: string): Promise<string> {
  const resolved = resolve(path);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const root = await canonicalRoot(options.root);
  const maxBytes = options.maxFileBytes > 0 ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  const files: ScannedFile[] = [];
  const skipped: SkipCounts = { binary: 0, lockfile: 0, tooLarge: 0, gitignored: 0 };

  for await (const walkedFile of walk(root, options.followSymlinks)) {
    const relPath = relative(root, walkedFile.path).split("\\").join("/");

    if (ALWAYS_EXCLUDE.some((pattern) => pattern.test(relPath))) continue;
    if (isGitignored(relPath, walkedFile.ignoreContexts)) {
      skipped.gitignored++;
      continue;
    }
    if (LOCKFILE_NAMES.has(basename(relPath))) {
      skipped.lockfile++;
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(walkedFile.path);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size === 0) continue;
    if (fileStat.size > maxBytes) {
      skipped.tooLarge++;
      continue;
    }

    const dotIndex = relPath.lastIndexOf(".");
    const extension = dotIndex >= 0 ? relPath.substring(dotIndex).toLowerCase() : "";
    const name = basename(relPath);
    if (!TEXT_EXT_HINT.has(extension) && !TEXT_EXT_HINT.has(name)) continue;

    let content;
    try {
      content = await readFile(walkedFile.path);
    } catch {
      continue;
    }
    if (isBinaryBuffer(content)) {
      skipped.binary++;
      continue;
    }

    files.push({
      path: walkedFile.path,
      relPath,
      size: fileStat.size,
      lines: countLines(content.toString("utf8")),
    });
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root, files, skipped };
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) lines++;
  }
  if (text.charCodeAt(text.length - 1) !== 10) lines++;
  return lines;
}
