import { describe, expect, it } from 'vitest';
import { problemOfIntegrityViolation, rethrowMapped, SUPERSEDES_KEY } from '../../src/modules/timeline/domain/integrity-violation.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';

describe('a constraint of the database is a mapped 409, never a 500 (EVM-037 K9; SR-API-01)', () => {
  it('EVM-037 K9 the unique key of the correction is entry_superseded; every other violation of a constraint is invalid_state_transition', () => {
    expect(problemOfIntegrityViolation({ code: '23505', constraint: SUPERSEDES_KEY })).toBe('entry_superseded');
    expect(problemOfIntegrityViolation({ code: '23505', constraint: 'timeline_entries_pkey' })).toBe('invalid_state_transition');
    expect(problemOfIntegrityViolation({ code: '23503', constraint: 'timeline_entries_stage_fk' })).toBe('invalid_state_transition');
    expect(problemOfIntegrityViolation({ code: '23514' })).toBe('invalid_state_transition');
  });

  it('EVM-037 K9 an error that is not a violation of a constraint is not mapped: a timeout, a problem of the use case, a thing that is not an error', () => {
    expect(problemOfIntegrityViolation({ code: '57014' })).toBeUndefined();
    expect(problemOfIntegrityViolation({ code: 23505 })).toBeUndefined();
    expect(problemOfIntegrityViolation(new Error('boom'))).toBeUndefined();
    expect(problemOfIntegrityViolation(new ProblemException('not_found'))).toBeUndefined();
    expect(problemOfIntegrityViolation(null)).toBeUndefined();
    expect(problemOfIntegrityViolation('23505')).toBeUndefined();
  });

  it('EVM-037 K9 rethrowMapped throws the problem for a violation and the original error for anything else — with no name of a constraint', () => {
    expect(() =>
      rethrowMapped({ code: '23505', constraint: SUPERSEDES_KEY, detail: 'Key (supersedes_entry_id)=(x) already exists.' }),
    ).toThrow(expect.objectContaining({ code: 'entry_superseded', extras: {} }));
    const original = new Error('the pool is gone');
    expect(() => rethrowMapped(original)).toThrow(original);
    const problem = new ProblemException('not_found');
    expect(() => rethrowMapped(problem)).toThrow(problem);
  });
});
