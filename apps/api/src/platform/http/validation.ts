/**
 * Request validation at the boundary (ASVS V2.2.1, SR-INPUT-01): input is parsed with the Zod schema generated from
 * the contract; a failure becomes `400 validation_failed` with `errors[]` of JSON Pointer + code — never the value
 * (SR-ERR-02). Unknown keys are rejected (strict objects), which also stops `__proto__`/`constructor` smuggling.
 */
import { z } from 'zod';
import { ProblemException, type FieldError } from './problem.ts';

const MAX_ERRORS = 20;

const escapePointerToken = (token: PropertyKey): string => String(token).replaceAll('~', '~0').replaceAll('/', '~1');
const pointerOf = (path: readonly PropertyKey[]): string => path.map((token) => `/${escapePointerToken(token)}`).join('');

/** Keys of a resource that only the server sets (`readOnly: true` in the contract); naming one in an input is `read_only_field`. */
export type ReadOnlyKeys = ReadonlySet<string>;

/**
 * The `readOnly` keys of a resource, DERIVED from the contract: the generator emits the full schema of a resource and its
 * writable variant (without the `readOnly` properties) — the keys of the first that the second lacks are the fields of the server.
 * No module keeps a list by hand, so a field added to the contract as `readOnly` is refused with the right code at once.
 */
export function readOnlyKeys(full: z.ZodObject, writable: z.ZodObject): ReadOnlyKeys {
  return new Set(Object.keys(full.shape).filter((key) => !(key in writable.shape)));
}

/** A bound on a NUMBER is a range (`out_of_range`); a bound on a text or a list is a length (`too_short`, `too_long`). */
const isNumeric = (origin: string): boolean => origin === 'number' || origin === 'int';

function fieldErrors(issues: readonly z.core.$ZodIssue[], readOnly: ReadOnlyKeys): FieldError[] {
  const errors = issues.flatMap((issue): FieldError[] => {
    switch (issue.code) {
      case 'too_big':
        return [{ pointer: pointerOf(issue.path), code: isNumeric(issue.origin) ? 'out_of_range' : 'too_long' }];
      case 'too_small':
        return [{ pointer: pointerOf(issue.path), code: isNumeric(issue.origin) ? 'out_of_range' : 'too_short' }];
      case 'invalid_format':
        return [{ pointer: pointerOf(issue.path), code: 'invalid_format' }];
      case 'invalid_value':
        return [{ pointer: pointerOf(issue.path), code: 'invalid_value' }];
      case 'unrecognized_keys':
        return issue.keys.map((key) => ({
          pointer: pointerOf([...issue.path, key]),
          code: issue.path.length === 0 && readOnly.has(key) ? 'read_only_field' : 'unknown_field',
        }));
      case 'invalid_type':
        return [{ pointer: pointerOf(issue.path), code: issue.input === undefined ? 'required' : 'invalid_type' }];
      default:
        return [{ pointer: pointerOf(issue.path), code: 'invalid' }];
    }
  });
  const unique = new Map(errors.map((error) => [`${error.pointer}|${error.code}`, error]));
  return [...unique.values()].slice(0, MAX_ERRORS);
}

/** @param readOnly the fields of the server of the resource at the root of the input (see `readOnlyKeys`) */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, readOnly: ReadOnlyKeys = new Set()): z.output<S> {
  const result = schema.safeParse(input, { reportInput: true });
  if (!result.success) throw new ProblemException('validation_failed', { errors: fieldErrors(result.error.issues, readOnly) });
  return result.data;
}

/**
 * The same schema with every object closed: the schemas generated from the contract strip unknown keys, but the API
 * rejects them (`additionalProperties: false`, `unknown_field`) — an injected `userId` or `__proto__` is an error, never
 * silently ignored (CWE-915, CWE-1321). Open dictionaries (`z.record`) stay open.
 */
export function strictObjects(schema: z.ZodType): z.ZodType {
  // The definition is cloned, not rebuilt: the checks of the contract (`.max()`, `.min()`, refinements) stay in force.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const closed = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, strictObjects(value)]));
    return z.core.clone(schema, { ...schema._zod.def, shape: closed, catchall: z.never() });
  }
  if (schema instanceof z.ZodOptional) {
    return z.core.clone(schema, { ...schema._zod.def, innerType: strictObjects(schema.unwrap() as z.ZodType) });
  }
  if (schema instanceof z.ZodNullable) {
    return z.core.clone(schema, { ...schema._zod.def, innerType: strictObjects(schema.unwrap() as z.ZodType) });
  }
  if (schema instanceof z.ZodArray) {
    return z.core.clone(schema, { ...schema._zod.def, element: strictObjects(schema.element as z.ZodType) });
  }
  return schema;
}
