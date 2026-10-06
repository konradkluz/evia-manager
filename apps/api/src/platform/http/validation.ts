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

function fieldErrors(issues: readonly z.core.$ZodIssue[]): FieldError[] {
  const errors = issues.flatMap((issue): FieldError[] => {
    switch (issue.code) {
      case 'too_big':
        return [{ pointer: pointerOf(issue.path), code: 'too_long' }];
      case 'too_small':
        return [{ pointer: pointerOf(issue.path), code: 'too_short' }];
      case 'invalid_format':
        return [{ pointer: pointerOf(issue.path), code: 'invalid_format' }];
      case 'invalid_value':
        return [{ pointer: pointerOf(issue.path), code: 'invalid_value' }];
      case 'unrecognized_keys':
        return issue.keys.map((key) => ({ pointer: pointerOf([...issue.path, key]), code: 'unknown_field' }));
      case 'invalid_type':
        return [{ pointer: pointerOf(issue.path), code: issue.input === undefined ? 'required' : 'invalid_type' }];
      default:
        return [{ pointer: pointerOf(issue.path), code: 'invalid' }];
    }
  });
  const unique = new Map(errors.map((error) => [`${error.pointer}|${error.code}`, error]));
  return [...unique.values()].slice(0, MAX_ERRORS);
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input, { reportInput: true });
  if (!result.success) throw new ProblemException('validation_failed', { errors: fieldErrors(result.error.issues) });
  return result.data;
}

/**
 * The same schema with every object closed: the schemas generated from the contract strip unknown keys, but the API
 * rejects them (`additionalProperties: false`, `unknown_field`) — an injected `userId` or `__proto__` is an error, never
 * silently ignored (CWE-915, CWE-1321). Open dictionaries (`z.record`) stay open.
 */
export function strictObjects(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    return z.strictObject(Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, strictObjects(value)])));
  }
  if (schema instanceof z.ZodOptional) return strictObjects(schema.unwrap() as z.ZodType).optional();
  if (schema instanceof z.ZodArray) return z.array(strictObjects(schema.element as z.ZodType));
  return schema;
}
