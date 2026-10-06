/**
 * Authorization manifest generated from the bundled contract (ADR-0004, SR-AUTHZ-01): operationId → method, path,
 * query parameters and `x-evia-authz`. The API guard takes policies only from this manifest. Generation fails on an
 * operation without operationId or x-evia-authz and on a policy that does not match the strict schema below (unknown
 * key, empty `roles`/`channels` on a non-public operation, value outside the vocabulary) — a typo can never become a
 * fail-open policy (EVM-016 W3).
 */
import { z } from 'zod';

export const ROLES = ['administrator', 'editor', 'read_only'] as const;
export const CHANNELS = ['web', 'mobile'] as const;

const nonEmpty = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(16);

const policySchema = z
  .strictObject({
    public: z.literal(true).optional(),
    roles: nonEmpty(z.enum(ROLES)).optional(),
    channels: nonEmpty(z.enum(CHANNELS)).optional(),
    policy: z.string().min(1).max(100).optional(),
    anchor: z.string().min(1).max(100).optional(),
    stepUp: z.boolean().optional(),
    transitions: z.string().min(1).max(100).optional(),
    hiddenFields: z.record(z.enum(ROLES), z.array(z.string().min(1).max(100)).max(100)).optional(),
    audit: z.boolean().optional(),
    allowDuringMfaEnrollment: z.boolean().optional(),
  })
  .superRefine((policy, context) => {
    if (policy.public === true) {
      const extras = Object.keys(policy).filter((key) => key !== 'public');
      if (extras.length > 0) context.addIssue({ code: 'custom', message: `public operation must not declare: ${extras.join(', ')}` });
      return;
    }
    if (policy.roles === undefined)
      context.addIssue({ code: 'custom', path: ['roles'], message: 'a non-public operation needs a non-empty roles list' });
    if (policy.channels === undefined) {
      context.addIssue({ code: 'custom', path: ['channels'], message: 'a non-public operation needs a non-empty channels list' });
    }
  });

export type AuthzPolicy = z.infer<typeof policySchema>;

export interface OperationAuthz {
  readonly method: string;
  readonly path: string;
  /** Names of the declared query parameters (anything else is `unknown_parameter`). */
  readonly query: readonly string[];
  readonly authz: AuthzPolicy;
}

export type AuthzManifest = Readonly<Record<string, OperationAuthz>>;

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function queryNames(spec: unknown, pathItem: Record<string, unknown>, operation: Record<string, unknown>): string[] {
  const components = isRecord(spec) && isRecord(spec['components']) ? spec['components'] : {};
  const registry = isRecord(components['parameters']) ? components['parameters'] : {};
  const declared = [pathItem['parameters'], operation['parameters']].flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []));
  return declared.flatMap((parameter) => {
    let resolved = parameter;
    if (isRecord(parameter) && typeof parameter['$ref'] === 'string') {
      resolved = registry[parameter['$ref'].replace('#/components/parameters/', '')];
      if (resolved === undefined) throw new Error(`unresolved parameter reference ${parameter['$ref']}`);
    }
    return isRecord(resolved) && resolved['in'] === 'query' && typeof resolved['name'] === 'string' ? [resolved['name']] : [];
  });
}

export function buildAuthzManifest(spec: unknown): AuthzManifest {
  const manifest: Record<string, OperationAuthz> = {};
  const paths = isRecord(spec) && isRecord(spec['paths']) ? spec['paths'] : {};
  for (const [path, item] of Object.entries(paths)) {
    const pathItem = isRecord(item) ? item : {};
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHODS.includes(method) || !isRecord(operation)) continue;
      const id = operation['operationId'];
      const authz = operation['x-evia-authz'];
      if (typeof id !== 'string') throw new Error(`${method.toUpperCase()} ${path}: brak operationId`);
      if (!isRecord(authz)) throw new Error(`${id}: brak x-evia-authz`);
      if (id in manifest) throw new Error(`${id}: zduplikowany operationId`);
      const parsed = policySchema.safeParse(authz);
      if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(policy)'}: ${issue.message}`).join('; ');
        throw new Error(`${id}: nieprawidłowe x-evia-authz — ${problems}`);
      }
      manifest[id] = { method, path, query: queryNames(spec, pathItem, operation), authz: parsed.data };
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
