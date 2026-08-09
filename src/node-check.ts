/**
 * Runtime Node.js version check. Fails fast with a clear error rather than
 * letting some downstream feature explode with a confusing cryptic message.
 *
 * Engines declared >= 18.0.0 in package.json.
 */

const MIN_NODE_MAJOR = 18;

export function assertNodeVersion(): void {
  const v = process.versions.node;
  const major = parseInt(v.split(".")[0] ?? "0", 10);
  if (Number.isFinite(major) && major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `error: stapes-context-trim requires Node.js >= ${MIN_NODE_MAJOR}.0.0; you are running ${v}.\n` +
        `Upgrade Node and retry: https://nodejs.org/en/download\n`
    );
    process.exit(2);
  }
}