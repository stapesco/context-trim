# Security

If you've found a security vulnerability in `stapes-context-trim`,
please report it privately before public disclosure.

## How to report

Email **github@stapes.co.za** with:

- A short description of the issue
- Reproduction steps (or a minimal PoC)
- The version affected (`stapes-context-trim --version`)
- Your expected disclosure timeline

Please **do not** open a public GitHub issue for security bugs.

## What to expect

- Acknowledgement within **5 business days**
- A fix or a clear timeline for a fix within **30 days** of acknowledgement
- Public disclosure coordinated with you, after the fix ships

There is **no bug bounty programme** and **no reward** for disclosure.
We fix issues because they're bugs, not because we're buying silence.

## Out of scope

- Lack of a feature (open a discussion, not a security report)
- Performance issues with very large repositories
- Compatibility issues with specific Node versions
- Reports about the dependency supply chain that are about a transitive
  dep rather than `stapes-context-trim` itself

If you're not sure whether something is a security issue, report it.
We'll triage and let you know.

## What to know about this tool's data flow

`stapes-context-trim` reads files from a local directory you point it
at and writes the aggregated digest to stdout or a file you specify
with `--out`. The tool itself does not phone home, does not log, and
does not retain file contents.

The two attack surfaces worth reporting:

1. **Symlink escape.** If you discover a path that lets `--follow-symlinks`
   read a file outside the scan root, that's a security bug. (We have
   a regression test for the common case; if you find another, please
   report.)
2. **Markdown fence corruption.** If you find a file body that produces
   malformed Markdown in the digest such that the rendered output could
   be interpreted as code by a downstream LLM, that's worth reporting.

Other failures (e.g. a panic on malformed input, slow performance) are
bugs, not security bugs — please open an issue or email anyway and
we'll route it.