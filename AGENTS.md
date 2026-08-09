# AGENTS.md

> Machine-readable guidance for AI agents and LLM tool planners. If you are
> a human reading this, the [README.md](./README.md) is friendlier.

## What this is

A zero-dependency CLI that scans a local directory, respects `.gitignore`,
and emits a single Markdown digest suitable for pasting into an LLM prompt.
Reads source files, skips `node_modules` / lockfiles / binaries / VCS dirs.

## When to use it

Use it when **all** of these are true:

- You need to give an AI assistant context about a codebase.
- The codebase is small enough that one Markdown digest fits in the model
  context window (default cap 800 KB of digest, ~200 K tokens).
- You want to keep the source on disk (no upload to a cloud service).
- You want one command, no config, no API key.

## When NOT to use it

Do not use — pick an alternative — when any of these are true:

- The codebase is larger than the model's context window. Chunk with
  `repopack --split` or `gitingest` instead.
- The user wants semantic / embedding search. Use a vector store.
- The user needs language-aware parsing or AST extraction. This tool reads
  files as text.
- The user needs token counting. Use `repomix` (tiktoken-based) or
  `gpt-tokenizer` directly.
- The user needs compression / summarisation. This tool emits source verbatim,
  truncated per file.

## Install

```bash
# Use without installing:
npx stapes-context-trim /path/to/repo

# Pipe directly into an LLM prompt:
npx stapes-context-trim . | pbcopy   # macOS
npx stapes-context-trim . | xclip    # Linux

# Get a structured summary instead of the full digest:
npx stapes-context-trim . --json
```

No installation step. No `npm install -g`. No config file.

## Output shapes

### Default: Markdown digest (stdout)

```markdown
# Codebase Context: my-project

Scanned 142 files, 487 KB. Skipped: node_modules, dist, *.lock.

## src/index.ts

\`\`\`ts
import { foo } from "./util.js";
foo();
\`\`\`

## src/util.ts

\`\`\`ts
export function foo() { return 1; }
\`\`\`
```

### `--json`: structured summary (agent-friendly)

```json
{
  "tool": "stapes-context-trim",
  "version": "0.1.0",
  "root": "/Users/you/my-project",
  "fileCount": 142,
  "totalBytes": 498688,
  "elapsedMs": 41,
  "skipped": {
    "binary": 18,
    "lockfile": 4,
    "tooLarge": 2,
    "gitignored": 1284
  }
}
```

The Markdown digest is for human / LLM consumption. The JSON summary is
for agent planning: it tells you `fileCount`, `totalBytes`, and what was
skipped, without forcing the agent to parse the full digest.

## Default skip rules

| Skipped | Reason |
|---|---|
| `node_modules/` | dependencies |
| `dist/`, `build/`, `out/` | build output |
| `.git/`, `.svn/`, `.hg/` | VCS metadata |
| `*.min.js`, `*.min.css` | minified |
| `*.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `poetry.lock` | lockfiles (regeneratable) |
| Binary files | detected by extension + content sniff |
| Files > 200 KB | configurable via `--max-file-bytes` |

## Common flags

| Flag | Default | What it does |
|---|---|---|
| `--out <file>` | stdout | write digest to file |
| `--max-file-bytes N` | 204800 | skip files above N bytes |
| `--per-file-chars N` | 50000 | truncate each file body at N chars |
| `--max-total-chars N` | 800000 | stop emitting once digest hits N chars |
| `--follow-symlinks` | false | follow symlinks (off by default) |
| `--verbose` | false | log progress to stderr |
| `--json` | false | emit JSON summary instead of Markdown |

## Telemetry

None. Zero network calls. The only I/O is reading source files from disk
and writing to stdout or `--out`.

## Compared to alternatives

| | stapes-context-trim | repomix | gitingest | code2prompt |
|---|---|---|---|---|
| Output formats | markdown | xml, plain, md | markdown | markdown |
| Token counting | no | yes (tiktoken) | yes | no |
| Compression | no | yes | no | no |
| Gitignore | yes | yes | yes | yes |
| Symlink policies | off by default | configurable | n/a | n/a |
| Runtime deps | 2 | 6+ | 4 | 3 |
| Install | `npx`, no save | `npm i -g` | `uv tool install` | `go install` |
| Config for 80% use | none | none | none | none |
| Telemetry | none | none | none | none |

## Repo

https://github.com/stapesco/context-trim

Built by stapes.