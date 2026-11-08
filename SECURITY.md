# Security

If you have found a security vulnerability in `stapes-context-trim`,
report it privately before public disclosure.

## How to report

Email **github@stapes.co.za** with:

- A short description of the issue
- Reproduction steps or a minimal PoC
- The version affected (`stapes-context-trim --version`)
- Your expected disclosure timeline

Do **not** open a public GitHub issue for security bugs. GitHub issues
are disabled on this repository.

## What to expect

- Acknowledgement within **5 business days**
- A fix or a clear timeline for a fix within **30 days** of acknowledgement
- Public disclosure coordinated with you, after the fix ships

There is **no bug bounty programme** and **no reward** for disclosure.
The maintainer fixes issues because they are bugs, not because the
maintainer buys silence.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.3 | yes |
| 0.1.2, 0.1.1, 0.1.0 | no |

The supported Node.js floor is **22.12.0**. The tool exits with code 2 on
anything older. Node 18 and Node 20 are both end-of-life, so the floor
moved up with the 0.1.3 release.

## Out of scope

- Lack of a feature. Open a discussion elsewhere, not a security report
- Performance issues with very large repositories
- Compatibility issues with specific Node versions
- Reports about the dependency supply chain that target a transitive
  dep rather than `stapes-context-trim` itself

If you are unsure whether something is a security issue, report it.
The maintainer triages and lets you know.

## What to know about this tool's data flow

`stapes-context-trim` reads files from a local directory you point it
at and writes the aggregated digest to stdout or to a file you specify
with `--out`. The tool does not phone home, does not log, and does not
retain file contents.

The `--out` target is excluded from the scan, so the digest the tool
writes is never read back as source.

The two attack surfaces worth reporting:

1. **Symlink escape.** If you discover a path that lets `--follow-symlinks`
   read a file outside the scan root, that is a security bug. A
   regression test covers the common case. Report any other variant.
2. **Markdown fence corruption.** If you find a file body that produces
   malformed Markdown in the digest such that the rendered output could
   be interpreted as code by a downstream LLM, that is worth reporting.

Other failures (a panic on malformed input, slow performance) are bugs,
not security bugs. Email the address above and the maintainer routes it.