/**
 * Authorization manifest generated from the bundled contract (ADR-0004, SR-AUTHZ-01): operationId → method, path
 * and `x-evia-authz`. The API guard takes policies only from this manifest; generation fails on an operation without
 * operationId or x-evia-authz, so no gap can reach the server silently.
 */
export interface AuthzPolicy {
  readonly public?: boolean;
  readonly [key: string]: unknown;
}

export interface OperationAuthz {
  readonly method: string;
  readonly path: string;
  readonly authz: AuthzPolicy;
}

export type AuthzManifest = Readonly<Record<string, OperationAuthz>>;

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildAuthzManifest(spec: unknown): AuthzManifest {
  const manifest: Record<string, OperationAuthz> = {};
  const paths = isRecord(spec) && isRecord(spec['paths']) ? spec['paths'] : {};
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(isRecord(item) ? item : {})) {
      if (!METHODS.includes(method) || !isRecord(operation)) continue;
      const id = operation['operationId'];
      const authz = operation['x-evia-authz'];
      if (typeof id !== 'string') throw new Error(`${method.toUpperCase()} ${path}: brak operationId`);
      if (!isRecord(authz)) throw new Error(`${id}: brak x-evia-authz`);
      if (id in manifest) throw new Error(`${id}: zduplikowany operationId`);
      manifest[id] = { method, path, authz };
    }
  }
  return manifest;
}

export function renderAuthzModule(manifest: AuthzManifest): string {
  return [
    '// Authorization manifest generated from dist/openapi.json by src/build.ts (EVM-008) — do not edit.',
    "import type { AuthzManifest } from '../src/manifest.ts';",
    '',
    `export const AUTHZ_MANIFEST: AuthzManifest = Object.freeze(${JSON.stringify(manifest, null, 2)});`,
    '',
  ].join('\n');
}
