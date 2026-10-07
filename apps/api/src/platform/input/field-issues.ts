/**
 * Field errors of the rules the schema of the contract cannot state (SR-INPUT-01, SR-ERR-02): a JSON Pointer and a code, NEVER
 * the value. The domain of a module collects them while it normalises an input and answers all of them at once.
 */
import { plainText } from './plain-text.ts';

export interface FieldIssue {
  readonly pointer: string;
  readonly code: string;
}

export class Collector {
  readonly errors: FieldIssue[] = [];

  fail(pointer: string, code: string): void {
    this.errors.push({ pointer, code });
  }

  /** Normalises an optional text; a refused one is an error and `null`. */
  text(pointer: string, raw: string | undefined, rules: { maxLength: number; multiline?: boolean }): string | null {
    const result = plainText(raw, rules);
    if (!result.ok) {
      this.fail(pointer, result.code);
      return null;
    }
    return result.value ?? null;
  }

  required(pointer: string, raw: string | undefined, rules: { maxLength: number }): string | null {
    const result = plainText(raw, rules);
    if (!result.ok) this.fail(pointer, result.code);
    else if (result.value === undefined) this.fail(pointer, 'required');
    return result.ok ? (result.value ?? null) : null;
  }

  /** An optional value with a shape (a telephone number, an e-mail address): absent or empty is `null`, one that is not of the shape is an error. */
  shaped(pointer: string, raw: string | undefined, normalize: (raw: string) => string | undefined): string | null {
    if (raw === undefined || raw.trim() === '') return null;
    const value = normalize(raw);
    if (value === undefined) this.fail(pointer, 'invalid_format');
    return value ?? null;
  }
}
