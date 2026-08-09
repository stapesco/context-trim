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

import { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { scan } from "./scanner.js";
import { renderDigest } from "./renderer.js";
import { readFile } from "node:fs/promises";

const PROGRAM_VERSION = "0.1.0";

interface CliOptions {
  out?: string;
  maxFileBytes: string;
  maxTotalChars: string;
  perFileChars: string;
  followSymlinks: boolean;
  verbose: boolean;
  json: boolean;
}

function asInt(s: string, fallback: number): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const program = new Command();
  program
    .name("stapes-context-trim")
    .description("Strip a codebase down to the essentials for an AI prompt. Zero cloud.")
    .version(PROGRAM_VERSION)
    .argument("[path]", "directory to scan", ".")
    .option("-o, --out <file>", "write digest to file instead of stdout")
    .option("--max-file-bytes <n>", "skip files larger than N bytes", "204800")
    .option("--per-file-chars <n>", "truncate file body at N characters", "50000")
    .option("--max-total-chars <n>", "stop emitting once digest exceeds N chars", "800000")
    .option("--follow-symlinks", "follow symlinks (off by default)", false)
    .option("-v, --verbose", "log progress to stderr", false)
    .option("--json", "emit JSON summary instead of markdown", false)
    .parse(process.argv);

  const targetArg = program.args[0] ?? ".";
  const opts = program.opts<CliOptions>();

  const root = resolve(targetArg);
  const startedAt = Date.now();

  if (opts.verbose) {
    console.error(`scanning ${root}`);
  }

  const files = await scan({
    root,
    maxFileBytes: asInt(opts.maxFileBytes, 200 * 1024),
    followSymlinks: opts.followSymlinks,
  });

  if (opts.verbose) {
    console.error(`found ${files.length} text files`);
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  if (opts.json) {
    const summary = {
      tool: "stapes-context-trim",
      version: PROGRAM_VERSION,
      root,
      fileCount: files.length,
      totalBytes,
      durationMs: Date.now() - startedAt,
      fileList: files.map((f) => ({ path: f.relPath, size: f.size, lines: f.lines })),
    };
    const out = JSON.stringify(summary, null, 2);
    if (opts.out) await writeFile(opts.out, out, "utf8");
    else process.stdout.write(out + "\n");
    return;
  }

  const digest = await renderDigest(
    files,
    (abs) => readFile(abs, "utf8"),
    {
      title: `Codebase Context: ${root.split("/").pop() || root}`,
      root,
      totalBytes,
      perFileCharLimit: asInt(opts.perFileChars, 50_000),
      totalCharLimit: asInt(opts.maxTotalChars, 800_000),
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