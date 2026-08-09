# stapes-context-trim

Strip a codebase down to the essentials for an AI prompt. Zero cloud. Zero config.

When you paste a repo into an AI chat, the prompt gets bloated with `node_modules`, lockfiles, and binaries. This tool walks a directory, respects `.gitignore`, skips the noise, and emits a single Markdown digest you can paste into any LLM.

## Install

```bash
npx stapes-context-trim [path]
```

That's it. No API key. No account. No telemetry. No data leaves your machine.

To install permanently:

```bash
npm install -g stapes-context-trim
```

## Usage

```bash
# Scan the current directory, print Markdown digest to stdout.
stapes-context-trim

# Scan a specific path.
stapes-context-trim ./packages/api

# Write the digest to a file.
stapes-context-trim . --out context.md

# JSON summary instead of markdown.
stapes-context-trim . --json

# Tune the size limits. Useful when the digest would exceed your model's context window.
stapes-context-trim . --max-file-bytes 50000 --per-file-chars 20000 --max-total-chars 200000

# Verbose mode — logs progress to stderr.
stapes-context-trim . --verbose
```

## What it skips

- Files and directories matching `.gitignore`
- `node_modules`, `.git`, `dist`, `build`, `target`, `__pycache__`, `.venv`, `.next`, `.cache`, `.claude`, `.playwright-mcp`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `go.sum`, `bun.lock`, `bun.lockb`
- Files larger than `--max-file-bytes` (default 200 KB)
- Empty files
- Binary files (detected by NUL byte in the first 8 KB)
- Symlinks (unless `--follow-symlinks` is passed)

## Output format

A Markdown digest with one fenced code block per file. The header shows the root, file count, and total bytes. Each section is `## <relative path>` followed by the file contents in a fenced block. Files exceeding `--per-file-chars` are truncated and noted in a summary. Files beyond the `--max-total-chars` budget are not emitted at all.

## Why

The closest comparable tool is [repomix](https://github.com/yamadashy/repomix). Repomix ships more features. `stapes-context-trim` exists for users who want a single-purpose CLI with no config file, no compression choices, and only two runtime deps.

## License

MIT. Source available at [github.com/stapesco/context-trim](https://github.com/stapesco/context-trim). No PRs accepted. Fork it.