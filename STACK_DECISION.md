# Stack Decision — stapes-context-trim

**Decision date:** 2026-11-08
**Decided by:** stapes
**Framework version:** technology-selection-framework v0.x
**Data freshness:** 2026-11-08T07:56:31Z (endoflife.date, npm)

---

## 1. Hard constraints (Class 1)

| # | Constraint | Source |
|---|---|---|
| H1 | Runs on Node.js, distributed as an npm CLI invoked through `npx` | The tool's only interface is a command line. `npx` is the install path the README documents, so the runtime is Node and the transport is npm. |
| H2 | Zero network calls at runtime | The README and SECURITY.md both promise the tool phones home to nobody and runs fully offline. Any dependency that makes a request at import or run time is invalid. |
| H3 | Zero runtime dependencies beyond what earns its place | The README's comparison table advertises "2 runtime dependencies" as a selling point against repomix (6+), gitingest (4), and code2prompt (3). A third runtime dependency breaks that claim. |
| H4 | The published artifact is a single self-contained binary directory | The package ships `dist/` and nothing else. `npm ci && npm run build` must produce a working CLI with no install-time codegen. |
| H5 | Source files never leave the machine | SECURITY.md states the tool retains nothing and logs nothing. A telemetry library, an update checker, or a cloud-hosted parser all violate this. |

---

## 2. Workload profile

**System class:** Single-shot command-line utility. The process starts, walks a directory tree, reads text files, renders a digest, writes to stdout, and exits. There is no server, no daemon, no request loop, and no persistent state between runs.

**Dominant workload:** Filesystem traversal and text rendering. The hot path is `readdir` plus `readFile` on the small text files that survive filtering. I measured 50,000 files under an excluded `node_modules` directory at 272 ms and a 45-file real-world repo at 210 ms, so the cost is dominated by directory metadata rather than by content volume. Binary sniffing reads only the first 8 KB of each file.

**Interaction model:** One-shot, synchronous-to-the-user, exit-code driven. The contract that matters is the exit code (0 clean, 1 invalid args or a bad scan path, 2 unsupported runtime) and the shape of the `--json` summary. Agent runtimes consume the JSON; humans consume the Markdown.

**Interface surface:** A CLI with a small, stable flag set, plus one machine-readable output contract (`tool`, `version`, `root`, `fileCount`, `totalBytes`, `elapsedMs`, `skipped`, `fileList`). The `--json` schema is advertised as stable in AGENTS.md, so schema changes are a minor-version event.

---

## 3. Stack decision

### Language

**Chosen:** TypeScript 7.0.2, compiled to ES2022 ESM

| Candidate | Functional | Performance | Ecosystem | Productivity | Deploy | Security | Maintainability | Ops cost | Lock-in | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| TypeScript 7.0.2 | 9 | 9 | 10 | 9 | 10 | 9 | 9 | 10 | 10 | 85 |
| TypeScript 5.9.3 | 9 | 7 | 10 | 9 | 10 | 9 | 9 | 10 | 10 | 83 |
| Plain JavaScript (ESM) | 8 | 9 | 10 | 8 | 10 | 9 | 6 | 10 | 10 | 80 |

**Rejected:** Plain JavaScript — loses the compiler-checked contract on the `--json` schema, which is the one surface agents depend on. TypeScript 5.9.3 is functionally equivalent here but is the previous major; 7.0.2 is the current `latest` and its native compiler is measurably faster on the build step.

### CLI argument parsing

**Chosen:** commander 15.1.0

| Candidate | Functional | Performance | Ecosystem | Productivity | Deploy | Security | Maintainability | Ops cost | Lock-in | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| commander 15.1.0 | 9 | 10 | 10 | 9 | 10 | 9 | 9 | 10 | 10 | 86 |
| commander 11.1.0 | 9 | 10 | 10 | 9 | 10 | 8 | 9 | 10 | 10 | 85 |
| Node's built-in `util.parseArgs` | 7 | 10 | 10 | 6 | 10 | 10 | 8 | 10 | 10 | 81 |

**Rejected:** `util.parseArgs` — commander supplies the `InvalidArgumentError` path that the numeric-flag contract depends on. The tool rejects malformed flags with a clear message instead of a silent default, and reimplementing that on the stdlib parser means writing the validation layer by hand.

### `.gitignore` matching

**Chosen:** ignore 7.0.14

| Candidate | Functional | Performance | Ecosystem | Productivity | Deploy | Security | Maintainability | Ops cost | Lock-in | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| ignore 7.0.14 | 10 | 9 | 9 | 9 | 10 | 9 | 9 | 10 | 9 | 84 |
| ignore 5.3.2 | 9 | 9 | 9 | 9 | 10 | 8 | 9 | 10 | 9 | 82 |
| Hand-rolled matcher | 6 | 8 | 4 | 4 | 10 | 7 | 4 | 9 | 10 | 62 |

**Rejected:** A hand-rolled matcher. Git's ignore semantics include negation, directory-only patterns, anchoring, and per-directory scope. The `ignore` library implements them correctly, and I verified v7's `test()` returns the same `ignored` and `unignored` booleans as v5 across six rule and path combinations.

### Test runner

**Chosen:** vitest 5.1.0

| Candidate | Functional | Performance | Ecosystem | Productivity | Deploy | Security | Maintainability | Ops cost | Lock-in | Score |
|---|---|---|---|---|---|---|---|---|---|---|
| vitest 5.1.0 | 10 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 82 |
| vitest 1.6.1 | 9 | 7 | 9 | 9 | 9 | 5 | 8 | 9 | 9 | 74 |
| Node's built-in `node:test` | 7 | 9 | 10 | 6 | 10 | 10 | 7 | 10 | 10 | 79 |

**Rejected:** `node:test` — vitest's assertion ergonomics and watch mode pay for themselves across a 96-test suite, and the security column is the deciding factor: vitest 1.6.1 pulls in a critical prototype-pollution RCE (tinypool), a high-severity denial of service (source-map-js), and a moderate advisory (esbuild). Vitest 5 clears all three. `npm audit` now reports zero vulnerabilities across both the runtime and the development tree.

### Runtime

**Chosen:** Node.js 22.12.0 floor, tested on 24.0.0

Node 18 reached end-of-life on 2025-04-30 and Node 20 on 2026-04-30. Commander 15 requires Node >= 22.12.0. Because the runtime check must match the dependency's own floor exactly, `src/node-check.ts` compares the full version rather than the major alone.

---

## 4. Default + override log

- **Default held:** Node.js as the runtime, npm as the transport, TypeScript as the source language, and a minimal runtime dependency set. All of these match the defaults in the framework's table.
- **Default held:** Vitest as the test runner. The default held on the merits, and the vulnerability evidence made the upgrade necessary rather than optional.
- **Default overridden:** The supported Node floor was 18.0.0. It moved to 22.12.0 because both Node 18 and Node 20 are end-of-life and commander 15 requires Node >= 22.12.0. This is a breaking change for consumers on Node 18 through 21, so it ships in a minor release with the floor stated in `engines`, in the README, in AGENTS.md, and in the runtime check itself.
- **Default overridden:** TypeScript 5.9.3 was the previous choice. It moved to 7.0.2, the current `latest`. TypeScript 7 no longer auto-includes every `@types` package, so `tsconfig.json` gained an explicit `"types": ["node"]`.

---

## 5. Revisit triggers

- [ ] **Node 22 reaches end-of-life** (2027-04-30): re-evaluate the runtime floor and the `engines.node` range because commander will drop Node 22 support.
- [ ] **A `commander` release drops Node 22**: re-evaluate the floor, because the runtime check must track the dependency's own requirement.
- [ ] **A `vitest` release reintroduces a dependency with an install lifecycle script**: re-run the install-script gate review, because `.install-script-allowlist` records a decision per package and a new transitive package invalidates it.
- [ ] **A `vitest` release raises its Node floor above the tested runtime (24)**: re-evaluate the release workflow's `node-version` pin.
- [ ] **The `--json` schema gains a field**: update AGENTS.md and the README in the same commit, because the schema is advertised as stable and agents diff it.
- [ ] **`npm audit` reports a vulnerability in the runtime tree**: the runtime tree is what every `npx` consumer installs, so treat it as a release blocker rather than a backlog item.
