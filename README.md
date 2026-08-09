# stapes-context-trim

> AI coding assistants have token budgets. Your codebase does not. Every time you paste a repo into a chat, you fight the model context window — `node_modules`, lockfiles, binaries, build output, all of it.
>
> `stapes-context-trim` walks the tree, respects `.gitignore`, skips the noise, and emits one Markdown digest. One command. No cloud. No config.

## Why

The standard pattern is "copy the repo and paste it in." That works on a 200-file project. It fails on a 5,000-file monorepo. The model truncates the middle of the prompt. The rest is noise.

This tool solves that. It runs locally, in milliseconds, on any tree. It writes one Markdown file with one section per source file. The model gets exactly the code that matters.

The output format is stable and human-readable:

```
# Codebase Context: my-project

Files: 247
Bytes: 482103

---

## src/index.ts
export const main = () => {
  console.log("ready");
};

## src/util.ts
export const add = (a: number, b: number) => a + b;

End of digest.
```

Each section is `## <relative path>` plus the file contents in a fenced block. Files larger than `--per-file-chars` get truncated. Files past `--max-total-chars` get dropped.

## How

```bash
npx stapes-context-trim [path]
```

Defaults: scan `.`, emit Markdown to stdout, skip anything over 200 KB.

```bash
# Common options
stapes-context-trim . --out context.md          # write to a file
stapes-context-trim . --json                     # JSON summary instead
stapes-context-trim . --max-total-chars 200000   # cap the digest
stapes-context-trim . --verbose                  # log progress to stderr
```

## What it skips

- Files and directories matching `.gitignore`
- `node_modules`, `.git`, `dist`, `build`, `target`, `__pycache__`, `.venv`, `.next`, `.cache`, `.claude`, `.playwright-mcp`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `go.sum`, `bun.lock`, `bun.lockb`
- Files larger than `--max-file-bytes` (default 200 KB)
- Empty files
- Binary files (NUL byte in the first 8 KB)
- Symlinks (unless `--follow-symlinks`)

## Source

Visible at https://github.com/stapesco/context-trim. Built by stapes. Read the code. Fork it. PRs are not accepted.

## License

MIT