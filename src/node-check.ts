/**
 * Runtime Node.js version check. Fails fast with a clear error rather than
 * letting some downstream feature explode with a confusing cryptic message.
 *
 * Engines declared >= 18.0.0 in package.json.
 */

const MIN_NODE_MAJOR = 18;

/**
 * Parse a Node.js version string (e.g. "v18.17.0", "20.0.0") and return the
 * major version as an integer. Pure function — does not depend on the runtime
 * version of the calling process. Throws when the input is malformed so
 * callers can distinguish "unsupported" from "unparseable".
 */
export function nodeMajor(version: string): number {
  // Accept an optional leading "v" or "V", then digits . digits . digits, with
  // optional pre-release / build suffixes (e.g. "20.0.0-rc.1", "20.0.0+sha").
  // The major segment is required to be a non-empty integer.
  const match = /^v?(\d+)(?:\.\d+){0,2}(?:[-+][^\s]*)?$/i.exec(version.trim());
  if (match === null) {
    throw new Error(`Cannot parse Node.js version: ${JSON.stringify(version)}`);
  }
  const major = Number(match[1]);
  if (!Number.isSafeInteger(major)) {
    throw new Error(`Cannot parse Node.js version: ${JSON.stringify(version)}`);
  }
  return major;
}

export function assertNodeVersion(): void {
  const v = process.versions.node;
  let major: number;
  try {
    major = nodeMajor(v);
  } catch {
    // If the runtime version itself cannot be parsed, treat as unsupported
    // and exit with the same code — the user needs a fix either way.
    process.stderr.write(
      `error: stapes-context-trim cannot parse your Node.js version (${v}).\n` +
        `Upgrade Node and retry: https://nodejs.org/en/download\n`,
    );
    process.exit(2);
    return;
  }
  if (major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `error: stapes-context-trim requires Node.js >= ${MIN_NODE_MAJOR}.0.0; you are running ${v}.\n` +
        `Upgrade Node and retry: https://nodejs.org/en/download\n`,
    );
    process.exit(2);
  }
}
