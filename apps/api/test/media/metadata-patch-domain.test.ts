import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_DESCRIPTION_MAX,
  isEmpty,
  MEDIA_DESCRIPTION_MAX,
  normaliseDescription,
  normaliseTitle,
  realChange,
} from '../../src/modules/media/domain/metadata-patch.ts';

describe('EVM-048 AC2 AC3 the description is plain text; empty after trimming means none (SR-INPUT-05)', () => {
  it('EVM-048 AC2 an absent description stays absent and an explicit null clears it', () => {
    expect(normaliseDescription(undefined, MEDIA_DESCRIPTION_MAX)).toEqual({ ok: true, value: undefined });
    expect(normaliseDescription(null, MEDIA_DESCRIPTION_MAX)).toEqual({ ok: true, value: null });
  });

  it('EVM-048 AC2 the text is NFC, trimmed, may have new lines and a text that is empty after trimming is null', () => {
    expect(normaliseDescription('  Zdjecie \r\n rozdzielnicy  ', MEDIA_DESCRIPTION_MAX)).toEqual({
      ok: true,
      value: 'Zdjecie \n rozdzielnicy',
    });
    expect(normaliseDescription('é', MEDIA_DESCRIPTION_MAX)).toEqual({ ok: true, value: 'é' });
    expect(normaliseDescription(' \n\t ', MEDIA_DESCRIPTION_MAX)).toEqual({ ok: true, value: null });
  });

  it('EVM-048 AC2 AC3 control and invisible characters and a text over the limit (counted after normalisation) are refused with a code at /description', () => {
    for (const bad of ['a\u0000b', 'a\u202Eb', 'a\u200Bb', 'a\u2028b']) {
      expect(normaliseDescription(bad, MEDIA_DESCRIPTION_MAX), JSON.stringify(bad)).toEqual({
        ok: false,
        issue: { pointer: '/description', code: 'invalid_characters' },
      });
    }
    expect(normaliseDescription('x'.repeat(MEDIA_DESCRIPTION_MAX + 1), MEDIA_DESCRIPTION_MAX)).toEqual({
      ok: false,
      issue: { pointer: '/description', code: 'too_long' },
    });
    expect(normaliseDescription(`${'x'.repeat(MEDIA_DESCRIPTION_MAX)}   `, MEDIA_DESCRIPTION_MAX).ok).toBe(true);
    expect(normaliseDescription('x'.repeat(DOCUMENT_DESCRIPTION_MAX), DOCUMENT_DESCRIPTION_MAX).ok).toBe(true);
  });
});

describe('EVM-048 AC3 the title is plain text on one line and cannot be empty (SR-INPUT-05)', () => {
  it('EVM-048 AC3 an absent title stays absent; the text is trimmed', () => {
    expect(normaliseTitle(undefined)).toEqual({ ok: true, value: undefined });
    expect(normaliseTitle('  Warunki przylaczenia ')).toEqual({ ok: true, value: 'Warunki przylaczenia' });
  });

  it('EVM-048 AC3 a title empty after trimming is required, a new line and a control character are invalid, over 200 is too long', () => {
    expect(normaliseTitle('   ')).toEqual({ ok: false, issue: { pointer: '/title', code: 'required' } });
    expect(normaliseTitle('a\nb')).toEqual({ ok: false, issue: { pointer: '/title', code: 'invalid_characters' } });
    expect(normaliseTitle('a\u0007b')).toEqual({ ok: false, issue: { pointer: '/title', code: 'invalid_characters' } });
    expect(normaliseTitle('x'.repeat(201))).toEqual({ ok: false, issue: { pointer: '/title', code: 'too_long' } });
  });
});

describe('EVM-048 AC2 AC3 only the REAL change is written (a request that changes nothing is 200 without audit)', () => {
  const current = { category: 'in_progress', description: null, procedureStageId: null as string | null };

  it('EVM-048 AC2 a field that is absent or equal to the current one is dropped', () => {
    expect(realChange({ category: undefined, description: undefined, procedureStageId: undefined }, current)).toEqual({});
    expect(realChange({ category: 'in_progress', description: null, procedureStageId: null }, current)).toEqual({});
    expect(isEmpty(realChange({ category: 'in_progress' }, current))).toBe(true);
  });

  it('EVM-048 AC2 a field that differs is kept, and null clears a value that is set', () => {
    expect(realChange({ category: 'defect', description: 'opis', procedureStageId: 'stage' }, current)).toEqual({
      category: 'defect',
      description: 'opis',
      procedureStageId: 'stage',
    });
    expect(realChange({ procedureStageId: null }, { ...current, procedureStageId: 'stage' })).toEqual({ procedureStageId: null });
    expect(isEmpty({ procedureStageId: null })).toBe(false);
  });
});
