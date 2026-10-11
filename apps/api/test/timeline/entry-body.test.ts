import { describe, expect, it } from 'vitest';
import { MAX_ENTRY_BODY_LENGTH, normalizeEntryBody } from '../../src/modules/timeline/domain/entry-body.ts';

const valueOf = (raw: string): string | undefined => {
  const result = normalizeEntryBody(raw);
  return result.ok ? result.value : undefined;
};
const codeOf = (raw: string): string | undefined => {
  const result = normalizeEntryBody(raw);
  return result.ok ? undefined : result.code;
};

describe('the text of a journal entry (EVM-037 AC4; SR-INPUT-05)', () => {
  it('EVM-037 AC4 markup and a javascript: link stay as text — nothing is escaped or removed', () => {
    expect(valueOf('<script>alert(1)</script> javascript:alert(1)')).toBe('<script>alert(1)</script> javascript:alert(1)');
  });

  it('EVM-037 AC4 control characters are removed but the new line stays; NUL is removed (the database would refuse it)', () => {
    expect(valueOf('a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg')).toBe('abcdefg');
    expect(valueOf('pierwsza\ndruga\n\ntrzecia')).toBe('pierwsza\ndruga\n\ntrzecia');
    expect(valueOf('tab\there')).toBe('tabhere');
  });

  it('EVM-037 AC4 CRLF and a lone CR become LF', () => {
    expect(valueOf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('EVM-037 AC4 the text is NFC and trimmed', () => {
    expect(valueOf('  Zo\u0301ła  \n')).toBe('Zóła');
    expect(valueOf('\n\n  tekst \n')).toBe('tekst');
  });

  it('EVM-037 AC4 the direction controls and the line and paragraph separators are removed (CWE-1007)', () => {
    expect(valueOf('a\u202Eb\u2066c\u2069d\u2028e\u2029f')).toBe('abcdef');
  });

  it('EVM-037 AC1 a text of 10 000 characters is accepted, 10 001 is too_long — counted in code points', () => {
    expect(valueOf('a'.repeat(MAX_ENTRY_BODY_LENGTH))?.length).toBe(MAX_ENTRY_BODY_LENGTH);
    expect(codeOf('a'.repeat(MAX_ENTRY_BODY_LENGTH + 1))).toBe('too_long');
    // 10 000 astral characters are 20 000 UTF-16 units but 10 000 code points
    expect(valueOf('😀'.repeat(MAX_ENTRY_BODY_LENGTH))).toBeDefined();
    expect(codeOf('😀'.repeat(MAX_ENTRY_BODY_LENGTH + 1))).toBe('too_long');
  });

  it('EVM-037 AC1 the length is taken AFTER normalisation and removal of control characters', () => {
    // 10 000 characters of text with 100 control characters inside: the text that is stored has 10 000
    expect(valueOf(`${'a'.repeat(5000)}${'\u0000'.repeat(100)}${'a'.repeat(5000)}`)?.length).toBe(10_000);
    // a decomposed letter is two code points before NFC and one after
    expect(valueOf('e\u0301'.repeat(MAX_ENTRY_BODY_LENGTH))?.length).toBe(MAX_ENTRY_BODY_LENGTH);
  });

  it('EVM-037 AC1 a text that is empty after trimming and removal is required', () => {
    expect(codeOf('')).toBe('required');
    expect(codeOf('   \n\t ')).toBe('required');
    expect(codeOf('\u0000\u0001‮')).toBe('required');
  });

  it('EVM-037 AC4 a lone surrogate is invalid_characters, never a database error', () => {
    expect(codeOf('a\uD800b')).toBe('invalid_characters');
    expect(codeOf('\uDC00')).toBe('invalid_characters');
    expect(valueOf('a😀b')).toBe('a😀b');
  });

  it('EVM-037 SR-ERR-02 the result of an error names a code only — never the text', () => {
    expect(JSON.stringify(normalizeEntryBody('secret\uD800'))).not.toContain('secret');
  });
});
