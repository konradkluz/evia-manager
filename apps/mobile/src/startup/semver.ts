/**
 * Minimal semver comparison for the minimum-version check (EVM-009 AC3), without a dependency. An invalid value is not comparable
 * (`null`): the caller then does not block the app, because blocking on bad data would lock the technician out of the own offline data.
 */

export interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly (string | number)[];
}

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value);
  if (match === null) return null;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!core.every(Number.isSafeInteger)) return null;
  const prerelease = (match[4]?.split('.') ?? []).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { core, prerelease };
}

function compareIdentifiers(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return Math.sign(left - right);
  if (typeof left === 'number') return -1; // numeric identifiers rank lower than alphanumeric ones
  if (typeof right === 'number') return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** @returns -1, 0, 1, or `null` when either side is not a valid semantic version; build metadata is ignored */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = Math.sign((a.core[index] ?? 0) - (b.core[index] ?? 0));
    if (difference !== 0) return difference as -1 | 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = compareIdentifiers(a.prerelease[index] ?? '', b.prerelease[index] ?? '');
    if (difference !== 0) return difference as -1 | 1;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length) as -1 | 0 | 1;
}
