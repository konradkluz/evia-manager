/**
 * The release manifest (EVM-007 AC2, AC3; ADR-0018 V3; architect 7). Written by the `publish` job of ci.yml as
 * `release-manifest.json`:
 *   { "schemaVersion": 1, "commit": "<40 hex>", "images": { "api": "<repo>@sha256:<64 hex>", "web": "…" },
 *     "compose": "<the compose path of the VM configuration>" }
 * manifestSha256 = SHA-256 (hex) of the EXACT bytes of release-manifest.json as stored in the artifact — the same value
 * in `publish` (job output for staging-verify), here, in the registry of deployments and in GET /api/version.
 */
import { createHash } from 'node:crypto';
import { DIGEST, Rejection, ensure, isRecord, string } from './errors.ts';

export interface Manifest {
  readonly commit: string;
  readonly images: { readonly api: string; readonly web: string };
  readonly compose: string;
}

export interface ManifestExpectations {
  readonly commit: string;
  readonly composePath: string;
  readonly repositories: { readonly api: string; readonly web: string };
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

const keysAre = (value: Record<string, unknown>, keys: string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

/** Image reference `<repository>@sha256:<64 hex>` of exactly the expected repository. */
function image(value: unknown, repository: string, name: string): string {
  const reference = string(value, 'v3-manifest-schema');
  const [repo = '', digest = '', ...rest] = reference.split('@');
  ensure(rest.length === 0 && repo === repository, 'v3-manifest-image', `${name}: repository outside the allow-list`);
  ensure(DIGEST.test(digest), 'v3-manifest-image', `${name}: not a sha256 digest`);
  return reference;
}

/** Parses the manifest bytes and checks them against the expected commit, compose path and repositories. */
export function parseManifest(bytes: Uint8Array, expected: ManifestExpectations): Manifest {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new Rejection('v3-manifest-schema', 'not valid UTF-8 JSON');
  }
  ensure(isRecord(document) && keysAre(document, ['schemaVersion', 'commit', 'images', 'compose']), 'v3-manifest-schema', 'keys');
  ensure(document['schemaVersion'] === 1, 'v3-manifest-schema', 'schemaVersion');
  ensure(document['commit'] === expected.commit, 'v3-manifest-commit', 'manifest of another commit');
  ensure(document['compose'] === expected.composePath, 'v3-manifest-compose', 'compose path differs from the VM configuration');
  const images = document['images'];
  ensure(isRecord(images) && keysAre(images, ['api', 'web']), 'v3-manifest-schema', 'images');
  return {
    commit: expected.commit,
    images: {
      api: image(images['api'], expected.repositories.api, 'api'),
      web: image(images['web'], expected.repositories.web, 'web'),
    },
    compose: expected.composePath,
  };
}
