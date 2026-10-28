/**
 * The version of the app (EVM-094 AC6; SR-API-08): `X-Client-Platform` and `X-Client-Version` serve compatibility ONLY (`426 client_version_unsupported`) —
 * a client can forge them, so they never decide authorization, the channel of an operation or an exemption from a check. A missing or malformed header in the
 * mobile channel is `426` too. Versions are `MAJOR.MINOR.PATCH` (the contract's `Semver`).
 */
export type ClientPlatform = 'android' | 'ios';

export interface ClientVersion {
  readonly platform: ClientPlatform;
  readonly version: string;
}

const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

function parts(version: string): [number, number, number] | undefined {
  const match = SEMVER.exec(version);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** @returns the platform and version of the headers, or undefined when either is missing or malformed */
export function readClientVersion(platform: string | undefined, version: string | undefined): ClientVersion | undefined {
  if (platform !== 'android' && platform !== 'ios') return undefined;
  if (version === undefined || parts(version) === undefined) return undefined;
  return { platform, version };
}

/** Is `version` at least `minimum`? */
export function atLeast(version: string, minimum: string): boolean {
  const have = parts(version);
  const need = parts(minimum);
  if (have === undefined || need === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
