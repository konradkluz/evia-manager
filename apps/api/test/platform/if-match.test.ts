import { describe, expect, it } from 'vitest';
import { entityTag, parseIfMatch } from '../../src/platform/http/if-match.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';

const problemOf = (value: string | undefined): ProblemException => {
  try {
    parseIfMatch(value);
  } catch (error) {
    if (error instanceof ProblemException) return error;
  }
  throw new Error('expected a problem');
};

describe('If-Match (ADR-0004, api-guidelines.md → Współbieżność; EVM-030 AC5; SR-API-06)', () => {
  it('EVM-030 AC5 a strong entity tag of a version is read back: "1", "42", the largest version of a 32-bit column', () => {
    expect(parseIfMatch('"1"')).toBe(1);
    expect(parseIfMatch('"42"')).toBe(42);
    expect(parseIfMatch('"2147483647"')).toBe(2_147_483_647);
  });

  it('EVM-030 AC5 the entity tag is written as the strong tag of the version the server reads', () => {
    expect(entityTag(7)).toBe('"7"');
    expect(parseIfMatch(entityTag(7))).toBe(7);
  });

  it('EVM-030 AC5 a missing header is 428 precondition_required (no pointer, no value)', () => {
    const problem = problemOf(undefined);
    expect(problem.code).toBe('precondition_required');
    expect(problem.extras).toEqual({});
  });

  it.each([
    ['a weak tag', 'W/"1"'],
    ['a list', '"1", "2"'],
    ['a list without a space', '"1","2"'],
    ['the wildcard', '*'],
    ['an empty header', ''],
    ['an empty tag', '""'],
    ['an unquoted number', '1'],
    ['a half-quoted number', '"1'],
    ['a number with a leading space inside the quotes', '" 1"'],
    ['a number with a trailing space', '"1" '],
    ['a leading space before the tag', ' "1"'],
    ['a non-numeric value', '"abc"'],
    ['a negative number', '"-1"'],
    ['a fraction', '"1.5"'],
    ['an exponent', '"1e3"'],
    ['a hexadecimal number', '"0x10"'],
    ['zero (versions start at 1)', '"0"'],
    ['a leading zero', '"01"'],
    ['a number past the 32-bit column', '"2147483648"'],
    ['a number that overflows a double', `"${'9'.repeat(400)}"`],
    ['single quotes', "'1'"],
    ['a line break inside', '"1\n"'],
  ])('EVM-030 AC5 %s is 400 validation_failed pointing at the header, with a code and never the value', (_name, value) => {
    const problem = problemOf(value);
    expect(problem.code).toBe('validation_failed');
    expect(problem.extras.errors).toEqual([{ pointer: '/headers/If-Match', code: 'invalid_format' }]);
    expect(JSON.stringify(problem.extras)).not.toContain('abc');
  });
});
