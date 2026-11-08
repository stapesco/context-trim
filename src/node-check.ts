/**
 * Runtime Node.js version check. Fails fast with a clear error rather than
 * letting some downstream feature explode with a confusing cryptic message.
 *
 * The floor is Node 22.12.0. Node 18 and Node 20 are both end-of-life, and
 * commander 15 (a runtime dependency) requires Node >= 22.12.0. The check
 * therefore compares the full version, not just the major: a Node 22.0.0
 * runtime passes a major-only check and then fails inside commander.
 *
 * The release workflow uses Node 24 (active LTS).
 */

/** Node 22 is the oldest major line this package supports. */
const MIN_NODE_MAJOR = 22;
/** Node 22.12 is the oldest 22.x release with the required ESM support. */
const MIN_NODE_MINOR = 12;
/** The patch level of the supported floor. */
const MIN_NODE_PATCH = 0;

/** The oldest runtime this package supports, as [major, minor, patch]. */
export const MIN_NODE_VERSION: readonly [number, number, number] = [
  MIN_NODE_MAJOR,
  MIN_NODE_MINOR,
  MIN_NODE_PATCH,
];

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a Node.js version string (e.g. "v18.17.0", "20.0.0") into its
 * numeric parts. Pure function — does not depend on the runtime version of
 * the calling process. Throws when the input is malformed so callers can
 * distinguish "unsupported" from "unparseable".
 *
 * A missing minor or patch segment reads as 0, so "22" parses as 22.0.0.
 */
export function parseNodeVersion(version: string): NodeVersion {
  // Accept an optional leading "v" or "V", then digits . digits . digits, with
  // optional pre-release / build suffixes (e.g. "20.0.0-rc.1", "20.0.0+sha").
  // The major segment is required to be a non-empty integer.
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][^\s]*)?$/i.exec(version.trim());
  if (match === null) {
    throw new Error(`Cannot parse Node.js version: ${JSON.stringify(version)}`);
  }
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new Error(`Cannot parse Node.js version: ${JSON.stringify(version)}`);
  }
  return { major, minor, patch };
}

/**
 * Parse a Node.js version string and return the major version as an integer.
 * Pure function — does not depend on the runtime version of the calling
 * process. Throws when the input is malformed so callers can distinguish
 * "unsupported" from "unparseable".
 */
export function nodeMajor(version: string): number {
  return parseNodeVersion(version).major;
}

/**
 * True when `version` is at or above the supported floor. Throws when the
 * version string cannot be parsed, so an unparseable runtime is never
 * mistaken for a supported one.
 */
export function isSupportedVersion(version: string): boolean {
  const { major, minor, patch } = parseNodeVersion(version);
  const [minMajor, minMinor, minPatch] = MIN_NODE_VERSION;
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

export function assertNodeVersion(): void {
  const v = process.versions.node;
  let supported: boolean;
  try {
    supported = isSupportedVersion(v);
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
  if (!supported) {
    const floor = MIN_NODE_VERSION.join(".");
    process.stderr.write(
      `error: stapes-context-trim requires Node.js >= ${floor}; you are running ${v}.\n` +
        `Upgrade Node and retry: https://nodejs.org/en/download\n`,
    );
    process.exit(2);
  }
}
