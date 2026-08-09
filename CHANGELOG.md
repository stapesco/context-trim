# Changelog

All notable changes to `stapes-context-trim` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-09

### Added

- One-command codebase-to-Markdown digest. `npx stapes-context-trim .`
  writes a single fenced Markdown document to stdout, one section per
  source file.
- `.gitignore` aware via the `ignore` library. Skips `node_modules`,
  `.venv`, `dist`, `build`, `target`, `.next`, `.cache`, `__pycache__`,
  `.claude`, `.playwright-mcp`, `.git`, `.svn`, `.hg`, minified assets,
  named lockfiles (full list below), binary files, empty files, and
  files above `--max-file-bytes`.
- `--json` summary mode for agents: `{tool, version, root, fileCount,
  totalBytes, elapsedMs, skipped.{binary, lockfile, tooLarge, gitignored},
  fileList}`.
- `--max-file-bytes`, `--per-file-chars`, `--max-total-chars`,
  `--follow-symlinks`, `--verbose`, `--out` for fine-grained control.
- `AGENTS.md` at the repo root — machine-readable install instructions,
  when-to-use / when-NOT-to-use, and the `--json` schema.
- Unit tests covering scanner, renderer, gitignore, and node-version
  behaviour. Strict TypeScript, ESM, Node 18+. Two runtime
  dependencies: `commander`, `ignore`.

### Notes

- Source-available under MIT. Issues disabled. Branch protection with
  `require_last_push_approval`. Pull requests are not accepted.
- Symlinks are NOT followed by default. Pass `--follow-symlinks` to
  follow them.
- The Markdown digest is fenced with language hints inferred from file
  extension. The `--json` mode reports per-file line counts in
  `fileList[].lines`; the Markdown body itself does not show them.

## [0.1.1] - 2026-08-09

Release-repair patch. Aggregates every fix shipped between 0.1.0 and
0.1.1 across the scanner, renderer, CLI, package metadata, and release
workflow. The CLI binary, digest header, `--json` output, and release
tag now derive from a single source of truth (`src/version.ts` and
`package.json`).

### Fixed

- **Fence selection in the renderer.** The previous fence was ` ``` `
  regardless of body content, so any file containing its own ` ``` `
  block (READMEs, docs, source with embedded samples) corrupted the
  outer digest. Now picks a fence length strictly greater than the
  longest backtick run in the body (CommonMark-compliant).

- **Symlink-following escaped the scan root.** `walk()` now calls
  `realpath()` on each symlink and rejects targets outside the
  canonicalised root. Includes a fix for the macOS `/var -> /private/var`
  symlink that broke legitimate in-root symlinks.

- **Renderer hardcoded version string.** Now reads `VERSION_STRING`
  exported from `src/version.ts`, so the version in the digest header
  stays in sync with `package.json`. `src/version.ts` is the single
  source of truth for `PROGRAM_VERSION`; both CLI and renderer import
  it.

- **CLI title with trailing slash.** `root.split("/").pop()` returned
  `""` for paths ending in `/`, producing ugly "Codebase Context: ..."
  output. Now uses `basename()` on the canonicalised root.

- **Truncation marker reported the configured cap, not the actual
  emitted length.** The marker now reports the ACTUAL number of source
  characters emitted (`sliceLen`), not `perFileLimit`. When the marker
  cannot fit inside the per-file budget, the slice falls back to
  `perFileLimit` and the marker correctly reports that value too.

- **Phantom section separator in total-limit accounting.** The previous
  `cost = sectionSeparator.length + section.length` over-counted by one
  `\n` per section and could force a premature truncation. The renderer
  now uses `section.length` directly, since each section already starts
  with `'\n'` from its header.

- **Silent coercion of malformed numeric flags.** Numeric flags
  (`--max-file-bytes`, `--per-file-chars`, `--max-total-chars`) now
  reject empty, signed, decimal, hex, and exponent input with a clear
  `InvalidArgumentError` from `commander`. There is no fallback that
  hides malformed input.

- **Package version drift between `package.json`, the CLI, and the
  renderer.** `package.json` is now `0.1.1`, matching the
  `PROGRAM_VERSION` constant. The phantom `main` field pointing to a
  non-existent `dist/index.js` is removed (the package is CLI-only;
  the entry is `dist/cli.js`).

- **Release publish could ship a tag that disagreed with the source
  version.** The release workflow now compares the git tag to
  `package.json` version between the test and publish steps and exits
  1 on mismatch.

### Added

- `SECURITY.md` with a private disclosure channel (email). No bug
  bounty; no SLA. Documents the 5-business-day acknowledgement target
  and 30-day fix target.
- Test coverage for every fix above: fence selection, fence closure,
  symlink scope (including the macOS `/var -> /private/var` case),
  truncation marker accuracy, total-limit accounting, CLI JSON
  contract, strict numeric flag parsing, and release-tag guard. The
  suite runs from `npm test` and is the gate before publish.