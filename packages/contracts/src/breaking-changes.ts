/**
 * Detection of breaking changes of the contract without a new dependency (EVM-090 AC7).
 *
 * TEMPORARY REPLACEMENT of oasdiff (ADR-0004, ADR-0012; api-guidelines.md → Wersjonowanie): oasdiff is not part of the CI yet, so the bundled
 * contract (dist/openapi.json) is compared with the last accepted one (baseline/openapi.json). The comparison works on schemas with `$ref`
 * resolved and is deliberately conservative: a construct it does not understand (`oneOf`/`anyOf`/`allOf`/`not`/`discriminator`, except the
 * `nullable` pair `oneOf: [X, {type: null}]`) that changed in ANY way is reported as breaking (fail-closed).
 * Operations marked `x-evia-planned: true` IN THE BASELINE are skipped: they have no route and no client in the field.
 *
 * The baseline is the contract of the LAST RELEASE (what the apps in the field use), not the state of HEAD: additive changes do not make
 * it stale, so parallel stories never fight over the generated file. It is rewritten by hand at a release or when a breaking change is
 * accepted in an ADR.
 *
 *   node src/breaking-changes.ts check                            → exit 1 when the bundle breaks the baseline
 *   node src/breaking-changes.ts update [--allow-breaking ADR-n]  → rewrites the baseline; refused when the diff has a breaking change,
 *                                                                    unless an ADR that accepts it is named. Manual only, never in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export interface BreakingChange {
  /** Stable rule identifier, e.g. `response-property-enum-value-added`. */
  readonly rule: string;
  /** Location in the contract, e.g. `POST /api/v1/x → 200 → application/json → /properties/a`. */
  readonly at: string;
  readonly message: string;
}

type Dict = Record<string, unknown>;
type Direction = 'request' | 'response';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
/** Keys that never change the behaviour of a schema; ignored when constructs are compared structurally. */
const ANNOTATIONS = new Set(['description', 'summary', 'title', 'example', 'examples', 'externalDocs', 'deprecated']);
const COMPOSITION = ['oneOf', 'anyOf', 'allOf', 'not', 'discriminator', 'if', 'then', 'else', 'dependentSchemas', 'patternProperties'];
const UPPER_LIMITS = ['maxLength', 'maxItems', 'maximum', 'exclusiveMaximum', 'maxProperties'] as const;
const LOWER_LIMITS = ['minLength', 'minItems', 'minimum', 'exclusiveMinimum', 'minProperties'] as const;

const SYNC_ENTITY = 'SyncEntity';
const SYNC_PROJECTIONS = 'x-evia-sync-projections';
const SYNC_OPERATIONS = ['getSyncChanges', 'getSyncWorkOrder'];

const isRecord = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Dict => (isRecord(value) ? value : {});

/** Recursively sorted keys: the same document always serialises to the same text. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/** Canonical form of a baseline: sorted keys, 2 spaces, LF, one trailing newline. */
export const canonicalJson = (value: unknown): string => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

const same = (left: unknown, right: unknown): boolean => JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));

class Differ {
  readonly changes: BreakingChange[] = [];
  private readonly active = new Set<string>();

  private readonly baseline: Dict;
  private readonly current: Dict;

  constructor(baseline: Dict, current: Dict) {
    this.baseline = baseline;
    this.current = current;
  }

  private report(rule: string, at: string, message: string): void {
    this.changes.push({ rule, at, message });
  }

  /** A node with its local `$ref` chain followed; `ref` is the last reference followed. */
  private resolve(document: Dict, node: unknown): { node: Dict; ref?: string } {
    let ref: string | undefined;
    let value = node;
    for (let hops = 0; isRecord(value) && typeof value['$ref'] === 'string'; hops += 1) {
      ref = value['$ref'];
      if (hops > 32) throw new Error(`reference chain too long at ${ref}`);
      value = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce<unknown>((target, key) => (isRecord(target) ? target[key] : undefined), document);
      if (value === undefined) throw new Error(`unresolved reference ${ref}`);
    }
    return ref === undefined ? { node: asRecord(value) } : { node: asRecord(value), ref };
  }

  /** The whole subtree with every reference replaced by its target (a cycle is cut to a marker) and annotations dropped. */
  private flatten(document: Dict, node: unknown, trail: readonly string[] = []): unknown {
    if (Array.isArray(node)) return node.map((item) => this.flatten(document, item, trail));
    if (!isRecord(node)) return node;
    if (typeof node['$ref'] === 'string') {
      if (trail.includes(node['$ref'])) return { $cycle: node['$ref'] };
      const target = this.resolve(document, node);
      return this.flatten(document, target.node, [...trail, node['$ref']]);
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !ANNOTATIONS.has(key))
        .map(([key, item]) => [key, this.flatten(document, item, trail)]),
    );
  }

  diff(): void {
    this.checkSecurity();
    const before = asRecord(this.baseline['paths']);
    const after = asRecord(this.current['paths']);
    for (const [path, pathItem] of Object.entries(before)) {
      for (const method of METHODS.filter((name) => isRecord(asRecord(pathItem)[name]))) {
        const label = `${method.toUpperCase()} ${path}`;
        // A planned operation has no route and no client in the field: refining or dropping it breaks nobody.
        if (asRecord(asRecord(pathItem)[method])['x-evia-planned'] === true) continue;
        const operation = asRecord(asRecord(after[path])[method]);
        if (Object.keys(operation).length === 0) {
          this.report('operation-removed', label, 'the operation (path or method) was removed');
          continue;
        }
        this.operation(label, asRecord(pathItem), asRecord(asRecord(pathItem)[method]), asRecord(after[path]), operation);
      }
    }
    this.syncProjections();
  }

  /** The type → projection map of the sync envelope (`x-evia-sync-projections`) of a document. */
  private projections(document: Dict): Dict {
    const entity = asRecord(asRecord(asRecord(document['components'])['schemas'])[SYNC_ENTITY]);
    return asRecord(entity[SYNC_PROJECTIONS]);
  }

  /** Whether every operation in the baseline that returns sync entities exists and is planned (then nothing is in the field). */
  private syncOperationsPlanned(): boolean {
    const found: Dict[] = [];
    for (const pathItem of Object.values(asRecord(this.baseline['paths']))) {
      for (const method of METHODS) {
        const operation = asRecord(asRecord(pathItem)[method]);
        if (SYNC_OPERATIONS.includes(String(operation['operationId']))) found.push(operation);
      }
    }
    return found.length > 0 && found.every((operation) => operation['x-evia-planned'] === true);
  }

  /**
   * Projections are not reachable by `$ref` from any operation (the envelope is open), so they are compared through the map:
   * a removed type or a changed projection is breaking once a sync operation is out of the planned state; a new type is not.
   */
  private syncProjections(): void {
    const before = this.projections(this.baseline);
    if (Object.keys(before).length === 0 || this.syncOperationsPlanned()) return;
    const after = this.projections(this.current);
    for (const [type, name] of Object.entries(before)) {
      const at = `sync projection ${type}`;
      if (typeof after[type] !== 'string') {
        this.report('sync-projection-removed', at, 'a sync entity type was removed from x-evia-sync-projections');
        continue;
      }
      const ref = (target: unknown) => ({ $ref: `#/components/schemas/${String(target)}` });
      this.schema('response', ref(name), ref(after[type]), at);
    }
  }

  private checkSecurity(): void {
    if (!same(this.baseline['security'], this.current['security'])) {
      this.report('security-changed', 'security', 'the document-level security requirement changed');
    }
    const before = asRecord(asRecord(this.baseline['components'])['securitySchemes']);
    const after = asRecord(asRecord(this.current['components'])['securitySchemes']);
    for (const [name, scheme] of Object.entries(before)) {
      if (!same(scheme, after[name]))
        this.report('security-scheme-changed', `securitySchemes/${name}`, 'a security scheme was changed or removed');
    }
  }

  private operation(label: string, beforeItem: Dict, before: Dict, afterItem: Dict, after: Dict): void {
    if (before['operationId'] !== after['operationId']) {
      this.report(
        'operation-id-changed',
        label,
        `operationId changed from ${String(before['operationId'])} to ${String(after['operationId'])}`,
      );
    }
    if (!same(before['security'], after['security']))
      this.report('security-changed', label, 'the security requirement of the operation changed');
    if (!same(before['x-evia-authz'], after['x-evia-authz'])) {
      this.report('authz-changed', label, 'x-evia-authz (roles, channels, policies) of the operation changed');
    }
    this.parameters(label, [beforeItem, before], [afterItem, after]);
    this.requestBody(label, before['requestBody'], after['requestBody']);
    this.responses(label, asRecord(before['responses']), asRecord(after['responses']));
  }

  private parameters(label: string, before: readonly Dict[], after: readonly Dict[]): void {
    const collect = (document: Dict, sources: readonly Dict[]): Map<string, Dict> => {
      const parameters = new Map<string, Dict>();
      for (const source of sources) {
        const list = Array.isArray(source['parameters']) ? (source['parameters'] as unknown[]) : [];
        for (const entry of list) {
          const { node } = this.resolve(document, entry);
          const location = String(node['in']);
          const name = location === 'header' ? String(node['name']).toLowerCase() : String(node['name']);
          parameters.set(`${location}:${name}`, node);
        }
      }
      return parameters;
    };
    const old = collect(this.baseline, before);
    const next = collect(this.current, after);
    for (const [key, parameter] of old) {
      const at = `${label} → parameter ${key}`;
      const replacement = next.get(key);
      if (replacement === undefined) {
        this.report('request-parameter-removed', at, 'the parameter was removed');
        continue;
      }
      if (parameter['required'] !== true && replacement['required'] === true) {
        this.report('request-parameter-became-required', at, 'an optional parameter became required');
      }
      this.schema('request', parameter['schema'], replacement['schema'], at);
    }
    for (const [key, parameter] of next) {
      if (!old.has(key) && parameter['required'] === true) {
        this.report('request-parameter-added-required', `${label} → parameter ${key}`, 'a new required parameter');
      }
    }
  }

  private requestBody(label: string, beforeBody: unknown, afterBody: unknown): void {
    const at = `${label} → request`;
    if (beforeBody === undefined) {
      if (afterBody !== undefined && this.resolve(this.current, afterBody).node['required'] === true) {
        this.report('request-body-added-required', at, 'a required request body was added');
      }
      return;
    }
    if (afterBody === undefined) return;
    const before = this.resolve(this.baseline, beforeBody).node;
    const after = this.resolve(this.current, afterBody).node;
    if (before['required'] !== true && after['required'] === true)
      this.report('request-body-became-required', at, 'the request body became required');
    const oldContent = asRecord(before['content']);
    const newContent = asRecord(after['content']);
    for (const [type, media] of Object.entries(oldContent)) {
      if (!(type in newContent)) continue;
      this.schema('request', asRecord(media)['schema'], asRecord(newContent[type])['schema'], `${at} → ${type}`);
    }
  }

  private responses(label: string, before: Dict, after: Dict): void {
    for (const [status, entry] of Object.entries(before)) {
      const at = `${label} → ${status}`;
      if (!(status in after)) {
        if (/^2\d\d$/.test(status)) this.report('response-success-removed', at, 'a success response was removed');
        continue;
      }
      const oldResponse = this.resolve(this.baseline, entry).node;
      const newResponse = this.resolve(this.current, after[status]).node;
      const oldHeaders = asRecord(oldResponse['headers']);
      const newHeaders = asRecord(newResponse['headers']);
      for (const name of Object.keys(oldHeaders)) {
        if (!(name in newHeaders)) this.report('response-header-removed', `${at} → header ${name}`, 'a response header was removed');
      }
      const oldContent = asRecord(oldResponse['content']);
      const newContent = asRecord(newResponse['content']);
      for (const [type, media] of Object.entries(oldContent)) {
        if (!(type in newContent)) {
          this.report('response-media-type-removed', `${at} → ${type}`, 'a response media type was removed');
          continue;
        }
        this.schema('response', asRecord(media)['schema'], asRecord(newContent[type])['schema'], `${at} → ${type}`);
      }
    }
  }

  /** A schema is the `nullable` pair `oneOf: [X, {type: null}]`: returns X, otherwise undefined. */
  private nullable(document: Dict, schema: Dict): unknown {
    const branches = schema['oneOf'];
    if (!Array.isArray(branches) || branches.length !== 2 || Object.keys(schema).some((key) => key !== 'oneOf' && !ANNOTATIONS.has(key))) {
      return undefined;
    }
    const isNull = (branch: unknown): boolean => this.resolve(document, branch).node['type'] === 'null';
    if (isNull(branches[1]) && !isNull(branches[0])) return branches[0];
    if (isNull(branches[0]) && !isNull(branches[1])) return branches[1];
    return undefined;
  }

  private hasComposition(schema: Dict): boolean {
    return COMPOSITION.some((key) => key in schema);
  }

  private schema(direction: Direction, beforeNode: unknown, afterNode: unknown, at: string): void {
    if (beforeNode === undefined || afterNode === undefined) return;
    const before = this.resolve(this.baseline, beforeNode);
    const after = this.resolve(this.current, afterNode);
    const guard = before.ref === undefined ? undefined : `${direction}|${before.ref}|${after.ref ?? ''}`;
    if (guard !== undefined) {
      if (this.active.has(guard)) return;
      this.active.add(guard);
    }
    try {
      this.compare(direction, before.node, after.node, at);
    } finally {
      if (guard !== undefined) this.active.delete(guard);
    }
  }

  private compare(direction: Direction, before: Dict, after: Dict, at: string): void {
    const wasNullable = this.nullable(this.baseline, before);
    const isNullable = this.nullable(this.current, after);
    const plain = (schema: Dict, pair: unknown): boolean => pair !== undefined || !this.hasComposition(schema);
    if ((wasNullable !== undefined || isNullable !== undefined) && plain(before, wasNullable) && plain(after, isNullable)) {
      this.nullability(direction, wasNullable !== undefined, isNullable !== undefined, at);
      this.schema(direction, wasNullable ?? before, isNullable ?? after, at);
      return;
    }
    if (this.hasComposition(before) || this.hasComposition(after)) {
      if (!same(this.flatten(this.baseline, before), this.flatten(this.current, after))) {
        this.report('composition-changed', at, 'a oneOf/anyOf/allOf/discriminator construct changed (not compared in detail, fail-closed)');
      }
      return;
    }
    this.types(before, after, at);
    this.enums(direction, before, after, at);
    if (direction === 'request') this.requestConstraints(before, after, at);
    this.format(direction, before, after, at);
    this.object(direction, before, after, at);
    if ('items' in before && 'items' in after) this.schema(direction, before['items'], after['items'], `${at} → /items`);
  }

  private nullability(direction: Direction, was: boolean, now: boolean, at: string): void {
    if (direction === 'response' && !was && now) this.report('response-became-nullable', at, 'a response value can now be null');
    if (direction === 'request' && was && !now) this.report('request-no-longer-nullable', at, 'a request value can no longer be null');
  }

  private types(before: Dict, after: Dict, at: string): void {
    const norm = (schema: Dict): string =>
      JSON.stringify(
        [schema['type']]
          .flat()
          .filter((item) => item !== undefined)
          .map(String)
          .sort(),
      );
    if (norm(before) !== norm(after)) this.report('type-changed', at, `type changed from ${norm(before)} to ${norm(after)}`);
  }

  private enums(direction: Direction, before: Dict, after: Dict, at: string): void {
    const list = (schema: Dict, key: string): unknown[] | undefined =>
      Array.isArray(schema[key]) ? (schema[key] as unknown[]) : undefined;
    if ('const' in before || 'const' in after) {
      if (!same(before['const'], after['const'])) this.report('const-changed', at, 'const changed');
    }
    const oldEnum = list(before, 'enum');
    const newEnum = list(after, 'enum');
    if (direction === 'response') {
      if (oldEnum !== undefined && newEnum === undefined) this.report('response-enum-removed', at, 'a closed response enum became open');
      const added = (newEnum ?? []).filter((value) => oldEnum !== undefined && !oldEnum.some((item) => same(item, value)));
      if (added.length > 0)
        this.report(
          'response-property-enum-value-added',
          at,
          `values added to a response enum: ${added.join(', ')} (use x-extensible-enum)`,
        );
    } else {
      if (oldEnum === undefined && newEnum !== undefined)
        this.report('request-enum-added', at, 'a request value is now restricted to an enum');
      const removed = (oldEnum ?? []).filter((value) => newEnum !== undefined && !newEnum.some((item) => same(item, value)));
      if (removed.length > 0) this.report('request-enum-value-removed', at, `values removed from a request enum: ${removed.join(', ')}`);
    }
    const oldOpen = list(before, 'x-extensible-enum');
    const newOpen = list(after, 'x-extensible-enum');
    const dropped = (oldOpen ?? []).filter((value) => !(newOpen ?? []).some((item) => same(item, value)));
    if (dropped.length > 0)
      this.report('extensible-enum-value-removed', at, `values removed from x-extensible-enum: ${dropped.join(', ')}`);
  }

  private requestConstraints(before: Dict, after: Dict, at: string): void {
    for (const limit of UPPER_LIMITS) {
      const was = before[limit];
      const now = after[limit];
      if (typeof now === 'number' && (typeof was !== 'number' || now < was))
        this.report('request-limit-tightened', at, `${limit} tightened (${String(was)} → ${now})`);
    }
    for (const limit of LOWER_LIMITS) {
      const was = before[limit];
      const now = after[limit];
      if (typeof now === 'number' && (typeof was !== 'number' || now > was))
        this.report('request-limit-tightened', at, `${limit} tightened (${String(was)} → ${now})`);
    }
    if (typeof after['pattern'] === 'string' && after['pattern'] !== before['pattern']) {
      this.report('request-pattern-added', at, 'a new or changed pattern restricts a request value');
    }
  }

  private format(direction: Direction, before: Dict, after: Dict, at: string): void {
    if (before['format'] === after['format']) return;
    if (direction === 'response' && before['format'] !== undefined)
      this.report('response-format-changed', at, 'the format of a response value changed');
    if (direction === 'request' && after['format'] !== undefined)
      this.report('request-format-changed', at, 'the format of a request value was added or changed');
  }

  private object(direction: Direction, before: Dict, after: Dict, at: string): void {
    const oldProperties = asRecord(before['properties']);
    const newProperties = asRecord(after['properties']);
    const oldRequired = new Set(Array.isArray(before['required']) ? (before['required'] as string[]) : []);
    const newRequired = new Set(Array.isArray(after['required']) ? (after['required'] as string[]) : []);
    if (before['additionalProperties'] === false && after['additionalProperties'] !== false) {
      this.report('additional-properties-opened', at, 'additionalProperties: false was removed');
    }
    for (const [name, property] of Object.entries(oldProperties)) {
      const place = `${at} → /properties/${name}`;
      if (!(name in newProperties)) {
        if (direction === 'response') this.report('response-property-removed', place, 'a response property was removed');
        else if (before['additionalProperties'] === false)
          this.report('request-property-removed', place, 'a request property was removed from a closed object');
        continue;
      }
      if (direction === 'response' && oldRequired.has(name) && !newRequired.has(name)) {
        this.report('response-property-became-optional', place, 'a response property is no longer required');
      }
      this.schema(direction, property, newProperties[name], place);
    }
    if (direction === 'request') {
      for (const name of newRequired) {
        if (!oldRequired.has(name))
          this.report('request-property-became-required', `${at} → /properties/${name}`, 'a request property is newly required');
      }
    }
    const extra = before['additionalProperties'];
    if (isRecord(extra) && isRecord(after['additionalProperties'])) {
      this.schema(direction, extra, after['additionalProperties'], `${at} → /additionalProperties`);
    }
  }
}

/** Breaking changes the `current` bundle introduces against the `baseline` bundle. Additive changes (new operations, new optional fields) are not reported. */
export function findBreakingChanges(baseline: unknown, current: unknown): BreakingChange[] {
  const differ = new Differ(asRecord(baseline), asRecord(current));
  differ.diff();
  return differ.changes;
}

export const BASELINE = 'baseline/openapi.json';
export const BUNDLE = 'dist/openapi.json';

export interface BaselineIo {
  readonly readBundle: () => unknown;
  readonly readBaseline: () => unknown;
  readonly writeBaseline: (text: string) => void;
  readonly print: (line: string) => void;
}

const ALLOW_BREAKING = /^ADR-\d{4}$/;

/** @returns process exit code: 0 ok, 1 breaking change, 2 wrong usage */
export function runBaselineCommand(args: readonly string[], io: BaselineIo): number {
  const [command, ...rest] = args;
  const bundle = io.readBundle();
  const baseline = io.readBaseline();
  const changes = findBreakingChanges(baseline, bundle);
  for (const change of changes) io.print(`BREAKING ${change.rule}: ${change.at} — ${change.message}`);
  if (command === 'check') {
    return changes.length > 0 ? 1 : 0;
  }
  if (command === 'update') {
    const flag = rest.indexOf('--allow-breaking');
    const adr = flag === -1 ? undefined : rest[flag + 1];
    if (flag !== -1 && (adr === undefined || !ALLOW_BREAKING.test(adr))) {
      io.print('--allow-breaking needs the ADR that accepts the change, e.g. --allow-breaking ADR-0021');
      return 2;
    }
    if (changes.length > 0 && adr === undefined) {
      io.print('Refused: the contract has breaking changes. Accept them in an ADR and rerun with --allow-breaking ADR-####.');
      return 1;
    }
    io.writeBaseline(canonicalJson(bundle));
    io.print(adr === undefined ? 'Baseline updated.' : `Baseline updated with ${changes.length} breaking change(s) accepted in ${adr}.`);
    return 0;
  }
  io.print('Usage: breaking-changes.ts check | update [--allow-breaking ADR-####]');
  return 2;
}

/* v8 ignore start -- process wiring of the command line; runBaselineCommand() is covered by tests */
if (import.meta.main) {
  process.exitCode = runBaselineCommand(process.argv.slice(2), {
    readBundle: () => JSON.parse(readFileSync(BUNDLE, 'utf8')) as unknown,
    readBaseline: () => JSON.parse(readFileSync(BASELINE, 'utf8')) as unknown,
    writeBaseline: (text) => {
      writeFileSync(BASELINE, text);
    },
    print: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
}
/* v8 ignore stop */
