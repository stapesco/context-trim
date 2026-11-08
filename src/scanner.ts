/**
 * File discovery and filtering for the context-trim CLI.
 *
 * Walks a directory tree, applies hierarchical .gitignore patterns, skips
 * binaries, lockfiles, and oversized files. Returns the canonical scan result.
 */

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import createIgnore from "ignore";

export interface ScanOptions {
  root: string;
  maxFileBytes: number;
  followSymlinks: boolean;
  /**
   * Absolute paths to exclude from the scan. Used to keep the digest the
   * tool writes out of its own input, which otherwise makes each run grow
   * the next one's output.
   */
  excludePaths?: string[];
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
  /** Dropped because the extension or filename is not a recognised text type. */
  unsupportedType: number;
  /** Dropped because the file is empty. */
  empty: number;
  /** Dropped by the always-excluded directory and minified-asset rules. */
  excluded: number;
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
/** The LF character code. Lines are counted by LF, not by CRLF. */
const LINE_FEED = 10;
/** The default when a caller passes no paths to exclude. */
const NO_EXCLUDED_PATHS: readonly string[] = [];

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

/**
 * Resolve the scan root and confirm it is a directory that exists.
 *
 * A missing or non-directory root throws instead of yielding an empty scan,
 * so a caller can tell "this directory has no files" from "you pointed me at
 * the wrong path".
 */
async function requireDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    throw new Error(`scan path does not exist: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`scan path is not a directory: ${resolved}`);
  }
  return canonicalRoot(resolved);
}

/**
 * Compare two paths by UTF-16 code unit.
 *
 * `localeCompare` is locale-sensitive, so the same repository produced a
 * different file order under a different `LC_ALL`. The `--json` contract
 * promises a stable shape, and agents diff these outputs, so the order must
 * not depend on the machine's locale.
 */
export function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The set of paths a scan must not return.
 *
 * Both the absolute form and the root-relative form are kept. The relative
 * form is what the walk compares against, so the exclusion still holds when
 * the scan root is reached through a symlink. A relative exclude path is
 * resolved against the scan root, which is what a caller naming a path
 * inside the tree means.
 */
interface ExclusionSet {
  absolute: Set<string>;
  relative: Set<string>;
}

async function buildExclusions(root: string, excludePaths: readonly string[]): Promise<ExclusionSet> {
  const absolute = new Set<string>();
  const relativePaths = new Set<string>();

  for (const excludedPath of excludePaths) {
    const resolved = isAbsolute(excludedPath) ? excludedPath : resolve(root, excludedPath);
    const candidates: string[] = [];
    try {
      candidates.push(await realpath(resolved));
    } catch {
      // The file may not exist yet (the tool writes it after scanning).
    }
    candidates.push(resolved);

    for (const candidate of candidates) {
      absolute.add(candidate);
      const rel = relative(root, candidate).split("\\").join("/");
      if (rel !== "" && !rel.startsWith("..")) {
        relativePaths.add(rel);
      }
    }
  }

  return { absolute, relative: relativePaths };
}

/**
 * The reason a walked file did not make it into the scan result, or null
 * when the file is kept.
 */
type DropReason = keyof SkipCounts;

function classifyByName(relPath: string, ignoreContexts: IgnoreContext[]): DropReason | null {
  if (ALWAYS_EXCLUDE.some((pattern) => pattern.test(relPath))) return "excluded";
  if (isGitignored(relPath, ignoreContexts)) return "gitignored";
  if (LOCKFILE_NAMES.has(basename(relPath))) return "lockfile";
  return null;
}

function classifyByContent(relPath: string, size: number, maxBytes: number): DropReason | null {
  if (size === 0) return "empty";
  if (size > maxBytes) return "tooLarge";
  const dotIndex = relPath.lastIndexOf(".");
  const extension = dotIndex >= 0 ? relPath.substring(dotIndex).toLowerCase() : "";
  const name = basename(relPath);
  if (!TEXT_EXT_HINT.has(extension) && !TEXT_EXT_HINT.has(name)) return "unsupportedType";
  return null;
}

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const root = await requireDirectory(options.root);
  const maxBytes = options.maxFileBytes > 0 ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  const files: ScannedFile[] = [];
  const skipped: SkipCounts = {
    binary: 0,
    lockfile: 0,
    tooLarge: 0,
    gitignored: 0,
    unsupportedType: 0,
    empty: 0,
    excluded: 0,
  };

  const exclusions = await buildExclusions(root, options.excludePaths ?? NO_EXCLUDED_PATHS);

  for await (const walkedFile of walk(root, options.followSymlinks)) {
    const relPath = relative(root, walkedFile.path).split("\\").join("/");

    if (exclusions.absolute.has(walkedFile.path) || exclusions.relative.has(relPath)) {
      continue;
    }

    const nameReason = classifyByName(relPath, walkedFile.ignoreContexts);
    if (nameReason !== null) {
      skipped[nameReason]++;
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(walkedFile.path);
    } catch {
      continue;
    }
    if (!fileStat.isFile()) continue;

    const contentReason = classifyByContent(relPath, fileStat.size, maxBytes);
    if (contentReason !== null) {
      skipped[contentReason]++;
      continue;
    }

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

  files.sort((a, b) => comparePaths(a.relPath, b.relPath));
  return { root, files, skipped };
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === LINE_FEED) lines++;
  }
  // A final line without a trailing newline still counts as a line.
  if (text.charCodeAt(text.length - 1) !== LINE_FEED) lines++;
  return lines;
}
