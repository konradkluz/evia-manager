/**
 * The local registry of deployments (EVM-007 AC4; ADR-0018 V6, "Rollback i migracje"; architect 13). Written ONLY by root
 * (`deploy.sh`) after a successful switch — atomically, a temporary file and a rename — and mounted read-only into the
 * verifier. Newest entry last. A rollback is allowed only to a commit of this registry.
 *   { "schemaVersion": 1, "entries": [ { "commit", "manifestSha256", "manifest" (exact text of release-manifest.json),
 *     "composeSha256", "activityEventId", "baseline", "deployedAt" } ] }
 */
import { Rejection, SHA, ensure, integer, isRecord, sha, string } from './errors.ts';
import { sha256 } from './manifest.ts';

export interface RegistryEntry {
  readonly commit: string;
  readonly manifestSha256: string;
  /** The exact text of release-manifest.json; its SHA-256 must equal manifestSha256. */
  readonly manifest: string;
  readonly composeSha256: string;
  /** The Activity event (pr_merge) that put this commit on main — the anchor of V0. */
  readonly activityEventId: number;
  /** The baseline commit configured when this entry was deployed (entries of an older baseline are ignored). */
  readonly baseline: string;
  readonly deployedAt: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const KEYS = ['commit', 'manifestSha256', 'manifest', 'composeSha256', 'activityEventId', 'baseline', 'deployedAt'];

/** Parses the registry (an absent file is an empty registry); any malformed entry rejects the whole cycle. */
export function parseRegistry(text: string | null): RegistryEntry[] {
  if (text === null) return [];
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Rejection('registry', 'not valid JSON');
  }
  ensure(isRecord(document) && document['schemaVersion'] === 1 && Array.isArray(document['entries']), 'registry', 'schema');
  return (document['entries'] as unknown[]).map((value, index) => {
    ensure(isRecord(value), 'registry', `entry ${String(index)}`);
    ensure(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...KEYS].sort()), 'registry', `entry ${String(index)}: keys`);
    const manifest = string(value['manifest'], 'registry');
    const manifestSha256 = string(value['manifestSha256'], 'registry');
    const composeSha256 = string(value['composeSha256'], 'registry');
    ensure(HEX64.test(manifestSha256) && HEX64.test(composeSha256), 'registry', `entry ${String(index)}: hashes`);
    ensure(sha256(manifest) === manifestSha256, 'registry', `entry ${String(index)}: manifest does not match its hash`);
    const deployedAt = string(value['deployedAt'], 'registry');
    ensure(!Number.isNaN(Date.parse(deployedAt)), 'registry', `entry ${String(index)}: deployedAt`);
    return {
      commit: sha(value['commit'], 'registry'),
      manifestSha256,
      manifest,
      composeSha256,
      activityEventId: integer(value['activityEventId'], 'registry'),
      baseline: sha(value['baseline'], 'registry'),
      deployedAt,
    };
  });
}

/** Entries deployed under the current baseline (an incident moves the baseline and starts a new chain). */
export function currentChain(entries: readonly RegistryEntry[], baseline: string): RegistryEntry[] {
  ensure(SHA.test(baseline), 'config', 'baseline');
  return entries.filter((entry) => entry.baseline === baseline);
}
