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

/**
 * The policies a value of a parameter or a field of the answer may depend on (EVM-056; ADR-0017 W4). A CLOSED vocabulary: the code
 * of the API evaluates each one (`paymentMilestone.read` — `canReadPayments` of `authorization`), so a name outside it is an error.
 */
export const RESTRICTING_POLICIES = ['paymentMilestone.read'] as const;

const nonEmpty = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(16);
const name = z.string().min(1).max(100);

/**
 * `restrictedParams` (EVM-056; api-guidelines.md → Autoryzacja): per policy, the values of parameters (`params`: name → values) and the
 * fields of the answer (`fields`) that only a caller the policy allows may use or see. Unlike `hiddenFields` (a static list per role),
 * this is a PREDICATE evaluated in code; the manifest declares it and the generation checks it against the operation.
 */
const restrictedParamsSchema = z.partialRecord(
  z.enum(RESTRICTING_POLICIES),
  z.strictObject({ params: z.record(name, nonEmpty(name)), fields: z.array(name).max(100) }),
);

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
    restrictedParams: restrictedParamsSchema.optional(),
    audit: z.boolean().optional(),
    allowDuringMfaEnrollment: z.boolean().optional(),
  })
  .superRefine((policy, context) => {
    if (policy.public === true) {
      const extras = Object.keys(policy).filter((key) => key !== 'public' && key !== 'channels');
      if (extras.length > 0) context.addIssue({ code: 'custom', message: `public operation must not declare: ${extras.join(', ')}` });
      // A public operation belongs to exactly one channel: the guard picks the CSRF/Origin checks from it (EVM-090; SR-AUTHZ-12).
      if (policy.channels !== undefined && policy.channels.length !== 1) {
        context.addIssue({ code: 'custom', path: ['channels'], message: 'a public operation lists exactly one channel' });
      }
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
  /**
   * `x-evia-planned: true` — the operation is in the contract but its route does not exist yet (EVM-090). The marker is the only source of truth:
   * the API test requires planned ⇒ no route and not planned ⇒ route; tests that iterate the manifest skip planned operations through
   * `implementedOperations()` of `@evia/contracts/authz`.
   */
  readonly planned?: true;
}

/** The channels of a policy: the declared ones, `[web]` for a public operation that declares none (the default of the panel). */
export function operationChannels(authz: AuthzPolicy): readonly (typeof CHANNELS)[number][] {
  return authz.channels ?? ['web'];
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

/** A local `$ref` of the bundle (`#/components/<kind>/<name>`) resolved; anything else is returned as it is. */
function resolve(spec: unknown, value: unknown): unknown {
  if (!isRecord(value) || typeof value['$ref'] !== 'string') return value;
  const reference = value['$ref'];
  const target = reference
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), spec);
  if (target === undefined) throw new Error(`unresolved reference ${reference}`);
  return resolve(spec, target);
}

/** The schema of a parameter of the query, or of a top-level property of the JSON body, named `parameter`; undefined when there is none. */
function parameterSchema(spec: unknown, pathItem: Record<string, unknown>, operation: Record<string, unknown>, parameter: string): unknown {
  const declared = [pathItem['parameters'], operation['parameters']].flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []));
  for (const entry of declared) {
    const resolved = resolve(spec, entry);
    if (isRecord(resolved) && resolved['in'] === 'query' && resolved['name'] === parameter) return resolve(spec, resolved['schema']);
  }
  const body = resolve(spec, operation['requestBody']);
  const content = isRecord(body) && isRecord(body['content']) ? body['content']['application/json'] : undefined;
  const schema = resolve(spec, isRecord(content) ? content['schema'] : undefined);
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {};
  return parameter in properties ? resolve(spec, properties[parameter]) : undefined;
}

/** The properties of the item of the `200` answer: the element of its `items` array (a list), or the answer itself. */
function answerItemProperties(spec: unknown, operation: Record<string, unknown>): Record<string, unknown> {
  const responses = isRecord(operation['responses']) ? operation['responses'] : {};
  const ok = resolve(spec, responses['200']);
  const content = isRecord(ok) && isRecord(ok['content']) ? ok['content']['application/json'] : undefined;
  const schema = resolve(spec, isRecord(content) ? content['schema'] : undefined);
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {};
  const list = resolve(spec, properties['items']);
  const item = isRecord(list) && list['type'] === 'array' ? resolve(spec, list['items']) : schema;
  return isRecord(item) && isRecord(item['properties']) ? item['properties'] : {};
}

/**
 * Every restricted parameter is a parameter of the query or a top-level property of the body of THIS operation, every value is in its
 * enum, and every field is a property of the item of the answer — a name or a value that does not exist fails the generation.
 */
function checkRestrictedParams(
  spec: unknown,
  id: string,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  policy: AuthzPolicy,
): void {
  for (const rule of Object.values(policy.restrictedParams ?? {})) {
    for (const [parameter, values] of Object.entries(rule.params)) {
      const schema = parameterSchema(spec, pathItem, operation, parameter);
      const allowed = isRecord(schema) && Array.isArray(schema['enum']) ? (schema['enum'] as unknown[]) : undefined;
      if (allowed === undefined) throw new Error(`${id}: restrictedParams — parametr ${parameter} nie istnieje albo nie ma enum`);
      const unknown = values.filter((value) => !allowed.includes(value));
      if (unknown.length > 0) throw new Error(`${id}: restrictedParams — ${parameter}: wartości spoza enum: ${unknown.join(', ')}`);
    }
    const properties = answerItemProperties(spec, operation);
    const missing = rule.fields.filter((field) => !(field in properties));
    if (missing.length > 0) throw new Error(`${id}: restrictedParams — pola spoza odpowiedzi: ${missing.join(', ')}`);
  }
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
      checkRestrictedParams(spec, id, pathItem, operation, parsed.data);
      const planned = operation['x-evia-planned'];
      if (planned !== undefined && planned !== true) throw new Error(`${id}: x-evia-planned może mieć wyłącznie wartość true`);
      manifest[id] = {
        method,
        path,
        query: queryNames(spec, pathItem, operation),
        authz: parsed.data,
        ...(planned === true ? { planned: true as const } : {}),
      };
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
