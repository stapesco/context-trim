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
  all common lockfiles, binary files, empty files, and files above
  `--max-file-bytes`.
- `--json` summary mode for agents: `{tool, version, root, fileCount,
  totalBytes, elapsedMs, skipped.{binary, lockfile, tooLarge, gitignored}}`.
- `--max-file-bytes`, `--per-file-chars`, `--max-total-chars`,
  `--follow-symlinks`, `--verbose`, `--out` for fine-grained control.
- `AGENTS.md` at the repo root — machine-readable install instructions,
  when-to-use / when-NOT-to-use, and the `--json` schema.
- 17 unit tests covering scanner, renderer, and gitignore behaviour.
- Strict TypeScript, ESM, Node 18+. Two runtime dependencies:
  `commander`, `ignore`.

### Notes

- Source-available under MIT. Issues disabled. Branch protection with
  `require_last_push_approval`. PRs are not accepted.
- Symlinks are NOT followed by default. Pass `--follow-symlinks` to
  follow them.
- The Markdown digest is fenced with language hints inferred from file
  extension. Output is line-numbered but does NOT include per-line line
  numbers — pair with `--json` if you need them.

## [0.1.1] - 2026-08-09

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
  exported from `cli.ts`, so the version in the digest header stays
  in sync with `package.json`.

- **CLI title with trailing slash.** `root.split("/").pop()` returned
  `""` for paths ending in `/`, producing ugly "Codebase Context: ..."
  output. Now strips trailing slashes before deriving the title.

### Added

- `SECURITY.md` with a private disclosure channel (email). No bug
  bounty; no SLA. Documents the 5-business-day acknowledgement target
  and 30-day fix target.
- 9 new tests covering fence selection and symlink scope.