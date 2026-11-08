#!/usr/bin/env node
/**
 * CLI entry for stapes-context-trim.
 *
 * Usage:
 *   stapes-context-trim [path] [--out file] [--max-file-bytes N] [--max-total-chars N]
 *
 * Default behaviour: read repo at ./, render Markdown to stdout.
 * --out writes to a file instead. Use --clipboard (later) if we add it.
 */

import { Command, InvalidArgumentError } from "commander";
import { basename, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { scan } from "./scanner.js";
import { renderDigest } from "./renderer.js";
import { readFile } from "node:fs/promises";
import { assertNodeVersion } from "./node-check.js";
import { PROGRAM_VERSION } from "./version.js";

interface CliOptions {
  out?: string;
  maxFileBytes: number;
  maxTotalChars: number;
  perFileChars: number;
  followSymlinks: boolean;
  verbose: boolean;
  json: boolean;
}

const DEFAULT_MAX_FILE_BYTES = 204800;
const DEFAULT_PER_FILE_CHARS = 50000;
const DEFAULT_MAX_TOTAL_CHARS = 800000;

/**
 * Parse a numeric CLI flag as a strict positive integer.
 * Throws an InvalidArgumentError that commander surfaces with the option name
 * and the word "option" in the error message, so callers can distinguish
 * invalid input from a missing default. No fallback hides malformed input.
 */
function positiveInt(value: string, optionName: string): number {
  // Reject empty, whitespace, signed, decimal, hex, or exponent input.
  // Only accept a base-10 positive integer with an optional leading +.
  if (!/^\+?\d+$/.test(value)) {
    throw new InvalidArgumentError(
      `option '${optionName}' value '${value}' is not a positive integer`,
    );
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new InvalidArgumentError(
      `option '${optionName}' value '${value}' is not a positive integer`,
    );
  }
  return n;
}

async function main() {
  assertNodeVersion();
  const program = new Command();
  program
    .name("stapes-context-trim")
    .description("Strip a codebase down to the essentials for an AI prompt. Zero cloud.")
    .version(PROGRAM_VERSION)
    .argument("[path]", "directory to scan", ".")
    .option("-o, --out <file>", "write digest to file instead of stdout")
    .option(
      "--max-file-bytes <n>",
      "skip files larger than N bytes",
      (v) => positiveInt(v, "--max-file-bytes"),
      DEFAULT_MAX_FILE_BYTES,
    )
    .option(
      "--per-file-chars <n>",
      "truncate file body at N characters",
      (v) => positiveInt(v, "--per-file-chars"),
      DEFAULT_PER_FILE_CHARS,
    )
    .option(
      "--max-total-chars <n>",
      "stop emitting once digest exceeds N chars",
      (v) => positiveInt(v, "--max-total-chars"),
      DEFAULT_MAX_TOTAL_CHARS,
    )
    .option("--follow-symlinks", "follow symlinks (off by default)", false)
    .option("-v, --verbose", "log progress to stderr", false)
    .option("--json", "emit JSON summary instead of markdown", false)
    .parse(process.argv);

  const targetArg = program.args[0] ?? ".";
  const opts = program.opts<CliOptions>();

  // Resolve the user-provided path; the canonical realpath comes from scan().
  const root = resolve(targetArg);
  const startedAt = Date.now();

  if (opts.verbose) {
    console.error(`scanning ${root}`);
  }

  const { root: scannedRoot, files, skipped } = await scan({
    root,
    maxFileBytes: opts.maxFileBytes,
    followSymlinks: opts.followSymlinks,
    // The digest this run writes must not be scanned as source on the next
    // run, or the output grows with every invocation.
    excludePaths: opts.out ? [resolve(opts.out)] : [],
  });

  if (opts.verbose) {
    console.error(`found ${files.length} text files`);
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  if (opts.json) {
    const summary = {
      tool: "stapes-context-trim",
      version: PROGRAM_VERSION,
      root: scannedRoot,
      fileCount: files.length,
      totalBytes,
      elapsedMs: Date.now() - startedAt,
      skipped,
      fileList: files.map((f) => ({ path: f.relPath, size: f.size, lines: f.lines })),
    };
    const out = JSON.stringify(summary, null, 2) + "\n";
    if (opts.out) await writeFile(opts.out, out, "utf8");
    else process.stdout.write(out);
    return;
  }

  const rootName = basename(scannedRoot) || scannedRoot;
  const digest = await renderDigest(
    files,
    (abs) => readFile(abs, "utf8"),
    {
      title: `Codebase Context: ${rootName}`,
      root: scannedRoot,
      totalBytes,
      perFileCharLimit: opts.perFileChars,
      totalCharLimit: opts.maxTotalChars,
    },
  );

  if (opts.verbose && digest.truncatedFiles.length > 0) {
    console.error(`truncated ${digest.truncatedFiles.length} files`);
  }
  if (opts.verbose && digest.truncated) {
    console.error(`digest hit total-char limit; remaining files skipped`);
  }

  if (opts.out) {
    await writeFile(opts.out, digest.markdown, "utf8");
    if (opts.verbose) console.error(`wrote ${opts.out}`);
  } else {
    process.stdout.write(digest.markdown);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`stapes-context-trim: ${message}`);
  process.exit(1);
});
