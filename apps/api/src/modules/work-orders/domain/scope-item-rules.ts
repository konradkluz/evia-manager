/**
 * The rules of the scope of a work order that need no framework (EVM-035 AC2, AC4, AC5; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05,
 * SR-DATA-02, SR-API-02): the limit of the scope, the notes (plain text — the typed column, never the JSONB), the description of a
 * "Inna usługa", the parameters against the set of the item (the SNAPSHOT of the set kept in the item, never a value of the client),
 * the codes of the processes, and the position of a new item. Every error is a JSON Pointer and a code, NEVER a value (SR-ERR-02).
 */
import { canonicalJson } from '../../../platform/idempotency/canonical-json.ts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';

/** The limit of the API (api-guidelines.md → "Limity obiektów podrzędnych"): active scope items per order. */
export const MAX_SCOPE_ITEMS = 50;
/** The limit of the API: processes per order (the same as the limit of `procedures`). */
export const MAX_PROCEDURES_PER_ORDER = 30;
export const NOTES_MAX_LENGTH = 1000;
/** The catalogue item that describes a service outside the catalogue (domain-model.md → `ScopeItem`): its notes are the description. */
export const CUSTOM_SERVICE_CODE = 'custom_service';

/** The names of the fields of a scope item whose change the journal records (the values are NOT recorded). */
export const SCOPE_ITEM_FIELDS = ['parameters', 'notes'] as const;
export type ScopeItemField = (typeof SCOPE_ITEM_FIELDS)[number];

export type ScopeParameters = Readonly<Record<string, string | number | boolean>>;

/** What `catalog` answers for a set of parameters (the part of `parseParameters` the rules need). */
export type ParametersParser = (
  code: string,
  input: unknown,
) =>
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly issues: readonly { readonly path: string; readonly code: string }[] };

const isEmpty = (parameters: object): boolean => Object.keys(parameters).length === 0;

/** The pointer of a field of the parameters, from a dotted path of the set; a path that is too long to be a pointer names the whole map. */
function parameterPointer(path: string): string {
  if (path === '') return '/parameters';
  const pointer = `/parameters/${path
    .split('.')
    .map((token) => token.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
  return pointer.length > 200 ? '/parameters' : pointer;
}

/** Keys that mean something to the runtime: never a parameter of any set (CWE-1321). */
const FORBIDDEN_PARAMETER_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * The OWN keys of the parameters of a request body that are never allowed, found on the body as it was parsed — before the schema of
 * the contract, whose map would drop a `__proto__` silently instead of refusing it (SR-INPUT-02, TM-19). `JSON.parse` makes
 * `__proto__` an own property, so `Object.hasOwn` sees it. A pointer and a code, never a value.
 */
export function forbiddenParameterKeys(body: unknown): FieldIssue[] {
  if (typeof body !== 'object' || body === null || !('parameters' in body)) return [];
  const { parameters } = body;
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) return [];
  return FORBIDDEN_PARAMETER_KEYS.filter((key) => Object.hasOwn(parameters, key)).map((key) => ({
    pointer: `/parameters/${key}`,
    code: 'unknown_field',
  }));
}

/** The codes of the set → the codes of the API: a bound is a range (`out_of_range`), the rest keeps its stable name. */
function parameterCode(code: string): string {
  if (code === 'too_big' || code === 'too_small') return 'out_of_range';
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'invalid';
}

/**
 * The parameters against the set of the item. `{}` is "no parameters yet" and is always accepted (a template copies items with
 * defaults that are partial); a map with keys is validated by the FULL view of the set — a field that is unknown (also `__proto__`
 * and `constructor`), out of range, of a wrong type or a map above 16 KB is refused. An item without a set takes `{}` only.
 */
export function validateParameters(
  parse: ParametersParser,
  parameterSetCode: string | null,
  parameters: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly value: ScopeParameters } | { readonly ok: false; readonly errors: readonly FieldIssue[] } {
  if (isEmpty(parameters)) return { ok: true, value: {} };
  if (parameterSetCode === null) return { ok: false, errors: [{ pointer: '/parameters', code: 'not_allowed' }] };
  const result = parse(parameterSetCode, parameters);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.issues.slice(0, 20).map((issue) => ({ pointer: parameterPointer(issue.path), code: parameterCode(issue.code) })),
    };
  }
  return { ok: true, value: result.value as ScopeParameters };
}

/**
 * The notes of an item: plain text, multi-line, 1–1000 characters; empty is `null`. The description of a "Inna usługa" is REQUIRED
 * (`required`), so an item of that kind never has empty notes.
 */
export function normalizeNotes(
  raw: string | null | undefined,
  options: { readonly required: boolean },
): { readonly ok: true; readonly value: string | null } | { readonly ok: false; readonly errors: readonly FieldIssue[] } {
  const issues = new Collector();
  const value = raw === null || raw === undefined ? null : issues.text('/notes', raw, { maxLength: NOTES_MAX_LENGTH, multiline: true });
  if (issues.errors.length === 0 && options.required && value === null) issues.fail('/notes', 'required');
  return issues.errors.length > 0 ? { ok: false, errors: issues.errors } : { ok: true, value };
}

/** The codes of the processes: each once, and each one of those the item brings (`not_brought_by_item`). */
export function validateProcedureCodes(
  requested: readonly string[],
  brought: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly FieldIssue[] } {
  const errors: FieldIssue[] = [];
  const seen = new Set<string>();
  requested.forEach((code, index) => {
    const pointer = `/procedureCodes/${index}`;
    if (seen.has(code)) errors.push({ pointer, code: 'duplicate' });
    else if (!brought.includes(code)) errors.push({ pointer, code: 'not_brought_by_item' });
    seen.add(code);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * The position of a new item: at the END of the scope. Positions are 1…n after every removal (see `renumber`), so it is n + 1; an
 * order with gaps (written by another path) gets the highest + 1, and when that is past the limit the lowest free one.
 */
export function nextPosition(taken: readonly number[]): number {
  const highest = taken.reduce((max, position) => Math.max(max, position), 0);
  if (highest < MAX_SCOPE_ITEMS) return highest + 1;
  const used = new Set(taken);
  for (let position = 1; position <= MAX_SCOPE_ITEMS; position += 1) if (!used.has(position)) return position;
  return MAX_SCOPE_ITEMS;
}

/** The names of the fields of an item that a change REALLY touches (the journal records names, never values). */
export function changedScopeFields(
  change: { readonly parameters?: ScopeParameters; readonly notes?: string | null },
  current: { readonly parameters: ScopeParameters; readonly notes: string | null },
): ScopeItemField[] {
  const changed: ScopeItemField[] = [];
  if (change.parameters !== undefined && canonicalJson(change.parameters) !== canonicalJson(current.parameters)) changed.push('parameters');
  if (change.notes !== undefined && change.notes !== current.notes) changed.push('notes');
  return changed;
}
