/**
 * The local registry of deployments (EVM-007 AC4; ADR-0018 V6, "Rollback i migracje"; architect 13). Written ONLY by root
 * (`deploy.sh`) after a successful switch — atomically, a temporary file and a rename — and mounted read-only into the
 * verifier. Newest entry last; the last entry is the version that serves.
 *   { "schemaVersion": 1, "entries": [ { "kind", "commit", "manifestSha256", "manifest" (exact text of
 *     release-manifest.json), "composeSha256", "activityEventId", "baseline", "deployedAt" } ] }
 * `kind`: `deploy` — a commit newer than every earlier deployment (the channel only moves forward along main);
 * `rollback` — the copy of an earlier `deploy` entry of the same baseline (same commit, hashes and Activity event). A
 * rollback never moves the frontier: the newest `deploy` entry stays the end of the verified Activity (verify.ts).
 * A rollback entry is accepted only when it repeats an earlier deploy entry exactly.
 */
import { Rejection, SHA, ensure, integer, isRecord, sha, string } from './errors.ts';
import { sha256 } from './manifest.ts';

export type EntryKind = 'deploy' | 'rollback';

export interface RegistryEntry {
  readonly kind: EntryKind;
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
const KEYS = ['kind', 'commit', 'manifestSha256', 'manifest', 'composeSha256', 'activityEventId', 'baseline', 'deployedAt'];

function parseEntry(value: unknown, index: number): RegistryEntry {
  const at = `entry ${String(index)}`;
  ensure(isRecord(value), 'registry', at);
  ensure(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...KEYS].sort()), 'registry', `${at}: keys`);
  const kind = value['kind'];
  ensure(kind === 'deploy' || kind === 'rollback', 'registry', `${at}: kind`);
  const manifest = string(value['manifest'], 'registry');
  const manifestSha256 = string(value['manifestSha256'], 'registry');
  const composeSha256 = string(value['composeSha256'], 'registry');
  ensure(HEX64.test(manifestSha256) && HEX64.test(composeSha256), 'registry', `${at}: hashes`);
  ensure(sha256(manifest) === manifestSha256, 'registry', `${at}: manifest does not match its hash`);
  const deployedAt = string(value['deployedAt'], 'registry');
  ensure(!Number.isNaN(Date.parse(deployedAt)), 'registry', `${at}: deployedAt`);
  return {
    kind,
    commit: sha(value['commit'], 'registry'),
    manifestSha256,
    manifest,
    composeSha256,
    activityEventId: integer(value['activityEventId'], 'registry'),
    baseline: sha(value['baseline'], 'registry'),
    deployedAt,
  };
}

const sameDeployment = (a: RegistryEntry, b: RegistryEntry): boolean =>
  a.commit === b.commit &&
  a.manifestSha256 === b.manifestSha256 &&
  a.composeSha256 === b.composeSha256 &&
  a.activityEventId === b.activityEventId &&
  a.baseline === b.baseline;

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
  const entries = (document['entries'] as unknown[]).map(parseEntry);
  for (const [index, entry] of entries.entries()) {
    if (entry.kind === 'deploy') continue;
    const earlier = entries.slice(0, index).filter((item) => item.kind === 'deploy');
    ensure(
      earlier.some((item) => sameDeployment(item, entry)),
      'registry',
      `entry ${String(index)}: a rollback that repeats no earlier deployment`,
    );
  }
  return entries;
}

/** Entries deployed under the current baseline (an incident moves the baseline and starts a new chain). */
export function currentChain(entries: readonly RegistryEntry[], baseline: string): RegistryEntry[] {
  ensure(SHA.test(baseline), 'config', 'baseline');
  return entries.filter((entry) => entry.baseline === baseline);
}
