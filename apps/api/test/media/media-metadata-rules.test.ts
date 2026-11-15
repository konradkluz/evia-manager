import { describe, expect, it } from 'vitest';
import { MEDIA_CATEGORIES, resolveNewMediaMetadata } from '../../src/modules/media/domain/media-metadata-rules.ts';

describe('the metadata of a new medium - one function for the panel and the phone (EVM-131 AC3; SR-INPUT-01, SR-INPUT-02)', () => {
  it('EVM-131 AC3 the seven categories of the panel are accepted, anything else is an invalid value at /category', () => {
    expect(MEDIA_CATEGORIES).toHaveLength(7);
    for (const category of MEDIA_CATEGORIES)
      expect(resolveNewMediaMetadata({ category })).toEqual({ ok: true, category, description: null });
    expect(resolveNewMediaMetadata({ category: 'selfie' })).toEqual({
      ok: false,
      issues: [{ pointer: '/category', code: 'invalid_value' }],
    });
  });

  it('EVM-131 AC3 the description is plain text: NFC, trimmed, line breaks kept; empty or blank means none; too long or with a control character is an issue at /description', () => {
    expect(resolveNewMediaMetadata({ category: 'other', description: '  Opiś  ' })).toMatchObject({
      ok: true,
      description: 'Opiś'.normalize('NFC'),
    });
    expect(resolveNewMediaMetadata({ category: 'other', description: 'a\nb' })).toMatchObject({ description: 'a\nb' });
    expect(resolveNewMediaMetadata({ category: 'other', description: '   ' })).toMatchObject({ ok: true, description: null });
    expect(resolveNewMediaMetadata({ category: 'other', description: null })).toMatchObject({ ok: true, description: null });
    const long = resolveNewMediaMetadata({ category: 'other', description: 'x'.repeat(1001) });
    expect(long.ok).toBe(false);
    expect(long.ok ? [] : long.issues.map((issue) => issue.pointer)).toEqual(['/description']);
    expect(resolveNewMediaMetadata({ category: 'other', description: 'a\u0000b' }).ok).toBe(false);
  });

  it('EVM-131 AC3 both issues are reported together', () => {
    const result = resolveNewMediaMetadata({ category: 'nope', description: 'x'.repeat(2000) });
    expect(result.ok ? [] : result.issues.map((issue) => issue.pointer)).toEqual(['/category', '/description']);
  });
});
