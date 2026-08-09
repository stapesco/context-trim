# Release Repair Design

## Goal

Ship one clean `0.1.1` release repair commit. Source behavior, package metadata, tests, and GitHub-facing documentation must agree.

## Invariants

1. Markdown fences always close, including when source ends with backticks.
2. Symlink following never escapes the scan root and never revisits a directory cycle.
3. Git ignore behavior includes root and nested `.gitignore` files.
4. JSON output has one intentional schema: `tool`, `version`, `root`, `fileCount`, `totalBytes`, `elapsedMs`, `skipped`, and `fileList`.
5. Skip counters reflect actual scanner decisions.
6. Documented default exclusions match scanner behavior.
7. Truncated source is visibly marked.
8. Language hints appear only when the renderer can infer a known safe hint.
9. Version metadata reports `0.1.1` everywhere.
10. Published package metadata references only emitted files.
11. Local Claude and DeepSec state stays untracked.
12. One commit contains source, tests, metadata, and documentation changes.

## Scope

### Scanner

- Return files and skip counters as one structured result.
- Count binary, lockfile, oversized, and gitignored exclusions.
- Apply nested `.gitignore` files relative to their directories.
- Track canonical directories when following symlinks.
- Skip repeated canonical directories.
- Add `out/` and minified asset exclusions.
- Include common extensionless source files such as `Makefile`, `Procfile`, `Justfile`, and `CMakeLists.txt`.

### Renderer

- Put the closing fence on a new line.
- Infer language hints from a small explicit mapping.
- Add a truncation marker.
- Include separators and the trailer in total-limit accounting.
- Read version data from a side-effect-free version module.

### CLI and package

- Emit the intentional JSON schema.
- Use `elapsedMs`, not `durationMs`.
- Keep `fileList` because it is useful, not for compatibility.
- Use platform-native basename handling.
- Report canonical scan root consistently.
- Remove the nonexistent `dist/index.js` package entry unless a public library API is deliberately added.
- Synchronize package, lockfile, CLI, examples, and manifest to `0.1.1`.

### Documentation

- Make README, AGENTS, CHANGELOG, and SECURITY match verified behavior.
- Remove contradictory or unverifiable statements.
- Keep GitHub-hosted settings claims only after GitHub API verification.
- Update `.gitignore` for `.claude/` and `.deepsec/` local state.

## Error handling

- Unreadable files remain distinct from empty files and render an explicit failure marker.
- Invalid numeric CLI input must fail instead of silently using a default.
- Filesystem traversal failures remain isolated to the affected path where safe.
- Root scan failures must exit nonzero with a clear message.

## Tests

Add regression coverage for:

- source ending in one or more backticks
- language hints
- truncation marker
- exact total character cap
- symlink cycles
- nested `.gitignore`
- skip counters
- `out/` and minified files
- extensionless text files
- JSON schema
- version consistency
- package contents

## Verification and publication

Run:

1. `npm run lint`
2. `npm run build`
3. `npm test`
4. `npm pack --dry-run`
5. CLI Markdown and JSON smoke tests
6. version consistency check
7. GitHub repository settings inspection
8. final diff and security review

Create one conventional commit with the required co-author trailer. Push `main` to `origin` using existing authenticated GitHub credentials. Do not print or store the PAT in repository files, logs, or commit metadata.

## Out of scope

- New product features beyond fixing reviewed behavior and claims.
- A new public library API.
- New runtime dependencies.
- UI work.
