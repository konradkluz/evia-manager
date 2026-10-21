/**
 * A failed check (EVM-007 AC3; ADR-0018 "fail-closed"): every problem — a violated rule, an unexpected answer of the
 * API, an exhausted limit — ends the cycle with `reject` and a reason code. The message holds identifiers only (SHA,
 * numeric IDs, PR numbers), never a token, a title, a commit message or an e-mail address (SR-LOG-02).
 */
export class Rejection extends Error {
  readonly code: string;

  constructor(code: string, detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.name = 'Rejection';
    this.code = code;
  }
}

/** Throws a Rejection unless the condition holds. */
export function ensure(condition: boolean, code: string, detail = ''): asserts condition {
  if (!condition) throw new Rejection(code, detail);
}

export const SHA = /^[0-9a-f]{40}$/;
export const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A record or a Rejection with the given code. */
export function record(value: unknown, code: string): Record<string, unknown> {
  ensure(isRecord(value), code, 'not an object');
  return value;
}

export function string(value: unknown, code: string): string {
  ensure(typeof value === 'string', code, 'not a string');
  return value;
}

export function integer(value: unknown, code: string): number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, code, 'not a non-negative integer');
  return value;
}

export function sha(value: unknown, code: string): string {
  const text = string(value, code);
  ensure(SHA.test(text), code, 'not a full commit SHA');
  return text;
}

export function array(value: unknown, code: string): unknown[] {
  ensure(Array.isArray(value), code, 'not an array');
  return value;
}
