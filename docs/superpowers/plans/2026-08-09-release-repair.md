# Release Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair all confirmed source, package, release, and documentation defects, then publish one clean commit to GitHub.

**Architecture:** The scanner becomes the sole source of file-selection decisions and returns files plus typed skip counters. The renderer owns safe Markdown framing and language hints. A side-effect-free version module supplies package-facing version text. Public documentation derives from verified behavior rather than aspirational examples.

**Tech Stack:** Node.js 18+, TypeScript ESM, Vitest, Commander, `ignore`, GitHub Actions, npm.

## Global Constraints

- Version metadata reports `0.1.1` everywhere.
- Add no runtime dependencies.
- Markdown fences close for every source body.
- Symlink following stays inside root and terminates on cycles.
- Root and nested `.gitignore` files apply relative to their directories.
- JSON fields are `tool`, `version`, `root`, `fileCount`, `totalBytes`, `elapsedMs`, `skipped`, and `fileList`.
- Local `.claude/` and `.deepsec/` state stays untracked.
- Source, tests, metadata, design, plan, and documentation land as one final commit.
- Never expose the stapesco PAT in files, logs, process arguments, or commit metadata.

---

## File map

- Create `src/version.ts`: side-effect-free `PROGRAM_VERSION` and `VERSION_STRING` constants.
- Create `test/cli.test.ts`: CLI JSON schema, version, argument, and output smoke tests.
- Modify `src/scanner.ts`: structured scan result, skip counters, nested ignore rules, symlink cycle detection, exclusions, text-name handling, canonical root.
- Modify `test/scanner.test.ts`: scanner invariants and regression cases.
- Modify `src/renderer.ts`: safe fences, language hints, truncation marker, exact limit accounting.
- Modify `test/renderer.test.ts`: renderer regressions and output contract.
- Modify `src/cli.ts`: consume structured scan result, strict numeric parsing, canonical path display, stable JSON schema.
- Modify `src/node-check.ts` and `test/node-check.test.ts`: fail on malformed runtime version input through a testable parser.
- Modify `package.json`, `package-lock.json`, `.techwatch-manifest.json`: version and package metadata.
- Modify `.gitignore`: ignore local Claude and DeepSec state.
- Modify `.github/workflows/release.yml`: verify package version matches tag before publish.
- Modify `README.md`, `AGENTS.md`, `CHANGELOG.md`, `SECURITY.md`: align every public claim.
- Modify `docs/superpowers/specs/2026-08-09-release-repair-design.md`: keep approved design in final squashed commit.
- Create `docs/superpowers/plans/2026-08-09-release-repair.md`: retain this executable plan in final squashed commit.

### Task 1: Scanner contract and filtering

**Files:**
- Modify: `src/scanner.ts`
- Modify: `test/scanner.test.ts`

**Interfaces:**
- Produces: `SkipCounts`, `ScanResult`, `scan(options): Promise<ScanResult>`.
- Produces: `ScanResult.root` as the canonical root used for traversal and reporting.
- Consumes: `ScanOptions` and the existing `ScannedFile` shape.

- [ ] **Step 1: Write failing contract and skip-counter tests**

Add expectations that `scan()` returns:

```ts
interface SkipCounts {
  binary: number;
  lockfile: number;
  tooLarge: number;
  gitignored: number;
}

interface ScanResult {
  root: string;
  files: ScannedFile[];
  skipped: SkipCounts;
}
```

Create files for each counted category and assert exact counter values. Update existing tests from `const files = await scan(...)` to `const { files } = await scan(...)`.

- [ ] **Step 2: Run scanner tests and verify failure**

Run: `npm test -- test/scanner.test.ts`

Expected: compile or assertion failures because `scan()` still returns `ScannedFile[]`.

- [ ] **Step 3: Implement the structured scanner result**

Export `SkipCounts` and `ScanResult`. Increment only the requested public categories. Return `{ root, files: out, skipped }`. Keep empty files and unsupported extensions uncounted because the public schema does not name those categories.

- [ ] **Step 4: Add failing nested-ignore tests**

Create:

```text
.gitignore: root-only.log
packages/app/.gitignore: ignored.ts
packages/app/ignored.ts
packages/app/keep.ts
```

Assert `root-only.log` and `packages/app/ignored.ts` are excluded while `packages/app/keep.ts` remains. Add a nested negation case to ensure local rules apply from their directory.

- [ ] **Step 5: Run the nested-ignore tests and verify failure**

Run: `npm test -- test/scanner.test.ts -t "nested .gitignore"`

Expected: nested ignored file appears.

- [ ] **Step 6: Implement hierarchical ignore contexts**

Represent each ignore file as:

```ts
interface IgnoreContext {
  baseRel: string;
  matcher: ReturnType<typeof createIgnore>;
}
```

Load `.gitignore` when entering each directory. Apply a context only when the candidate is inside `baseRel`. Pass the path relative to that context into `matcher.ignores()`. Preserve parent contexts and local negations in traversal order.

- [ ] **Step 7: Add a failing symlink-cycle test**

Create an in-root directory symlink pointing to an ancestor. Run with `followSymlinks: true`. Assert the physical source file appears once and the scan completes under the normal test timeout.

- [ ] **Step 8: Run the cycle test and verify failure**

Run: `npm test -- test/scanner.test.ts -t "cycle"`

Expected: duplicate files, timeout, or failed count.

- [ ] **Step 9: Implement canonical-directory cycle detection**

Before scanning a directory, resolve its real path. Keep `visitedDirectories: Set<string>`. Skip directories already visited. Preserve the existing root-containment test for every followed symlink.

- [ ] **Step 10: Add exclusion and text-name tests**

Assert these are excluded:

```text
out/generated.ts
app.min.js
style.min.css
```

Assert these are included:

```text
Makefile
Procfile
Justfile
CMakeLists.txt
```

Assert an arbitrary `custom.lock` is not claimed as a known lockfile unless a documented rule explicitly adds it.

- [ ] **Step 11: Implement exclusions and text-name support**

Add `out/` to directory exclusions. Add explicit minified filename regexes. Add common extensionless source basenames to `TEXT_EXT_HINT`. Do not add broad `*.lock` behavior.

- [ ] **Step 12: Run scanner tests**

Run: `npm test -- test/scanner.test.ts`

Expected: all scanner tests pass.

### Task 2: Renderer framing and limits

**Files:**
- Modify: `src/renderer.ts`
- Modify: `test/renderer.test.ts`
- Create: `src/version.ts`

**Interfaces:**
- Consumes: `ScannedFile.relPath` for language inference.
- Produces: `languageHint(relPath): string` or an internal equivalent.
- Produces: `PROGRAM_VERSION = "0.1.1"` and `VERSION_STRING` from `src/version.ts`.

- [ ] **Step 1: Add failing fence-ending tests**

Test bodies ending in `` ` ``, ` ``` `, and a truncated backtick run without trailing newlines. Assert the closing fence starts on a new line and every following file heading renders outside the code block.

- [ ] **Step 2: Run fence tests and verify failure**

Run: `npm test -- test/renderer.test.ts -t "ending"`

Expected: closing fence is concatenated to body.

- [ ] **Step 3: Fix fence closure**

Normalize section bodies so exactly one newline separates body content from the closing fence. Calculate fence length from the rendered body before adding the closing newline.

- [ ] **Step 4: Add failing language-hint tests**

Assert `.ts` emits `ts`, `.py` emits `python`, `.json` emits `json`, and unknown text extensions emit no info string. Assert the info string is appended only to the opening fence.

- [ ] **Step 5: Implement explicit language mapping**

Use a small constant map keyed by lowercase extension and recognized basename. Do not emit untrusted source text as an info string.

- [ ] **Step 6: Add failing truncation-marker test**

Render a body over the per-file limit. Assert the output contains a stable marker such as:

```text
[truncated: original 100 chars, showing 20]
```

Assert the marker sits inside the code fence and `truncatedFiles` contains the path.

- [ ] **Step 7: Implement the marker**

Reserve marker length inside the per-file budget where practical. If the configured limit is too small, emit the marker after the truncated body and document that the per-file limit applies to source characters, not metadata.

- [ ] **Step 8: Add exact total-limit tests**

Assert `result.markdown.length <= totalCharLimit`. Cover headers, section separators, and trailer. Add a limit too small for the fixed header and assert a clear error instead of silently exceeding it.

- [ ] **Step 9: Implement exact accounting**

Build complete candidate chunks before appending. Count separators and trailer. Reserve trailer space before each section. Throw a typed `RangeError` when the configured limit cannot contain the fixed header and trailer.

- [ ] **Step 10: Move version constants**

Create `src/version.ts`:

```ts
export const PROGRAM_VERSION = "0.1.1";
export const VERSION_STRING = `stapes-context-trim v${PROGRAM_VERSION}`;
```

Import it from CLI and renderer. Remove the renderer-to-CLI import cycle.

- [ ] **Step 11: Run renderer tests**

Run: `npm test -- test/renderer.test.ts`

Expected: all renderer tests pass.

### Task 3: CLI contract and validation

**Files:**
- Modify: `src/cli.ts`
- Create: `test/cli.test.ts`
- Modify: `src/node-check.ts`
- Modify: `test/node-check.test.ts`

**Interfaces:**
- Consumes: `ScanResult` from `scan()`.
- Consumes: `PROGRAM_VERSION` from `src/version.ts`.
- Produces JSON with `elapsedMs` and no `durationMs`.
- Produces strict positive integer parsing for all numeric flags.

- [ ] **Step 1: Add CLI JSON schema test**

Spawn `node dist/cli.js <fixture> --json` after a build. Parse stdout and assert exact required keys plus `fileList`. Assert `durationMs` is absent. Assert skip counters match fixture exclusions.

- [ ] **Step 2: Add invalid-number tests**

Cover nonnumeric, zero, and negative values for all three numeric flags. Expect exit code `1` and an explicit option error. No fallback may hide malformed input.

- [ ] **Step 3: Run CLI tests and verify failure**

Run: `npm run build && npm test -- test/cli.test.ts`

Expected: schema and invalid-number tests fail.

- [ ] **Step 4: Implement CLI schema and strict parsing**

Replace `asInt(s, fallback)` with:

```ts
function positiveInt(value: string, optionName: string): number
```

Throw when input is not a safe positive integer. Consume `{ root, files, skipped }`. Emit `elapsedMs`, `skipped`, and `fileList`. Write identical newline-terminated JSON to stdout and `--out`.

- [ ] **Step 5: Use native path handling**

Use `basename(root)` rather than `split("/")`. Use the canonical root returned by `scan()` in JSON and Markdown headers.

- [ ] **Step 6: Make Node-version parsing explicit**

Export a pure helper:

```ts
export function nodeMajor(version: string): number
```

Throw for malformed versions. Keep exit code `2` for an unsupported valid major. Test valid, old, and malformed input without mutating the actual runtime version.

- [ ] **Step 7: Run CLI and Node tests**

Run: `npm run build && npm test -- test/cli.test.ts test/node-check.test.ts`

Expected: all tests pass.

### Task 4: Package and release integrity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.techwatch-manifest.json`
- Modify: `.github/workflows/release.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `PROGRAM_VERSION` value `0.1.1`.
- Produces: CLI-only npm package with a valid `bin` and no nonexistent `main`.

- [ ] **Step 1: Add package integrity assertions to CLI tests**

Read `package.json` and assert version `0.1.1`, no `main` field, and `bin.stapes-context-trim === "dist/cli.js"`. Read `src/version.ts` or import its constant and assert equality.

- [ ] **Step 2: Run integrity test and verify failure**

Run: `npm test -- test/cli.test.ts -t "package metadata"`

Expected: package version is `0.1.0` and `main` exists.

- [ ] **Step 3: Synchronize package metadata**

Set `package.json` to `0.1.1`. Remove `main`. Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Update `.techwatch-manifest.json` to `0.1.1` while preserving reviewed dependency versions and date.

- [ ] **Step 4: Harden release tag validation**

Before publish, compare `${GITHUB_REF_NAME#v}` with `node -p "require('./package.json').version"`. Exit nonzero on mismatch. Keep the existing test and build gates. Verify whether npm trusted publishing is configured before changing token/provenance behavior. Do not remove provenance based on speculation.

- [ ] **Step 5: Update `.gitignore`**

Add:

```gitignore
.claude/
.deepsec/
```

Confirm `.techwatch-manifest.json` remains tracked. Do not add broad patterns that hide project documentation or release files.

- [ ] **Step 6: Run package checks**

Run:

```bash
npm run build
npm pack --dry-run
node dist/cli.js --version
```

Expected: package contains a valid CLI, no missing-main warning, and version `0.1.1`.

### Task 5: Public documentation alignment

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Consumes only behavior verified by Tasks 1-4.
- Produces one consistent human and agent contract.

- [ ] **Step 1: Update JSON examples**

Show `0.1.1`, `elapsedMs`, exact skip counters, and `fileList`. State that `fileList` contains `{path, size, lines}` entries.

- [ ] **Step 2: Update Markdown examples**

Show actual header lines, language hints, truncation marker, and fence behavior. Remove all fictional “Scanned ... Skipped ...” output.

- [ ] **Step 3: Align filtering documentation**

Document nested `.gitignore`, exact always-excluded directories, exact named lockfiles, minified assets, unsupported extensions, empty files, size limit, and symlink behavior. Remove the false `*.lock` claim.

- [ ] **Step 4: Align exit codes and test claims**

Document exit codes `0`, `1`, and `2`. Replace stale historical aggregate test counts with behavior-focused statements unless exact historical evidence is available.

- [ ] **Step 5: Correct changelog structure**

Keep `0.1.0` as historical behavior without retroactively claiming features it did not ship. Describe all repairs under `0.1.1`. Remove the contradictory line-number statement.

- [ ] **Step 6: Verify GitHub-hosted claims**

Use `gh api` to check issues, vulnerability reporting, branch protection, and last-push approval. Retain only claims supported by API results. Clarify the contribution posture consistently across README, CHANGELOG, and SECURITY.

- [ ] **Step 7: Lint prose**

Run `ste-lint README.md AGENTS.md CHANGELOG.md SECURITY.md docs/superpowers/specs/2026-08-09-release-repair-design.md docs/superpowers/plans/2026-08-09-release-repair.md` if the tool supports multiple files. Otherwise run one file at a time. Fix blocking violations without stripping necessary product voice from README.

### Task 6: Full verification, review, squash, and push

**Files:**
- Review all modified files.
- No new source behavior unless verification finds a defect.

**Interfaces:**
- Consumes all prior tasks.
- Produces one commit on `main` and pushes it to `origin/main`.

- [ ] **Step 1: Run the full verification suite**

Run:

```bash
npm run lint
npm run build
npm test
npm pack --dry-run
node dist/cli.js --version
node dist/cli.js . --json | jq '{tool, version, fileCount, totalBytes, elapsedMs, skipped, fileListCount: (.fileList | length)}'
```

Expected: all commands exit `0`, version is `0.1.1`, and JSON fields match the documented schema.

- [ ] **Step 2: Run focused security smoke tests**

Create disposable fixtures outside the repo for an escaping symlink, a symlink cycle, nested ignores, and a file ending in backticks. Run the built CLI. Confirm no outside-root content appears, traversal terminates, nested ignores work, and Markdown fences close.

- [ ] **Step 3: Review package contents and diff**

Confirm `.claude/` and `.deepsec/` are ignored. Confirm no PAT or secret appears. Confirm no generated tarball is left in the tree. Review `git diff --check` and `git diff HEAD~1`.

- [ ] **Step 4: Run code and security reviews**

Invoke the code-review and security-review skills over the final diff. Resolve every confirmed blocker or major finding. Re-run the full verification suite after edits.

- [ ] **Step 5: Squash the design commit and implementation into one commit**

Because commit `0133c28` has not been pushed, reset softly to its parent after all changes are ready:

```bash
git reset --soft 4f72899
git add --all
git commit -m "fix: make v0.1.1 behavior and docs consistent" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Confirm exactly one commit exists above `4f72899`.

- [ ] **Step 6: Push through existing authenticated origin**

Use the configured stapesco credential helper or `gh auth` session. Do not place the PAT in the remote URL. Run:

```bash
git push origin main
```

Expected: push succeeds and `origin/main` points to the new commit.

- [ ] **Step 7: Verify GitHub state after push**

Run `gh api repos/stapesco/context-trim/commits/main --jq '.sha'` and compare it to `git rev-parse HEAD`. Report commit SHA, verification commands, GitHub settings caveats, and any skipped release action. Do not create a tag or publish npm unless explicitly requested.
