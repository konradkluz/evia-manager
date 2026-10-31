import { describe, expect, it } from 'vitest';
import {
  DERIVATIVE_CACHE_CONTROL,
  DERIVATIVE_CONTENT_TYPE,
  DERIVATIVE_VARIANTS,
  MAX_PROCESSING_ATTEMPTS,
  STALE_PROCESSING_MS,
  VARIANT_EDGES,
  derivativeKey,
  hasDerivatives,
  isPermanent,
} from '../../src/modules/media/domain/derivatives.ts';
import { isDownloadable } from '../../src/modules/media/domain/scan-outcome.ts';
import { DERIVATIVE_URL_SECONDS } from '../../src/platform/object-storage/object-storage.ts';

const ID = '0198a7a0-0000-7000-8000-000000000001';

describe('EVM-068 AC6 the derivatives of a photo: keys, availability and the meaning of a failure', () => {
  it('EVM-068 AC2 the key of a derivative is the prefix of the ORIGINAL plus the name of the variant, and nothing else (the removal by prefix covers it)', () => {
    const original = `media/2026/10/${ID}/original`;
    expect(DERIVATIVE_VARIANTS).toEqual(['thumbnail', 'preview']);
    expect(derivativeKey(original, 'thumbnail')).toBe(`media/2026/10/${ID}/thumbnail.webp`);
    expect(derivativeKey(original, 'preview')).toBe(`media/2026/10/${ID}/preview.webp`);
    for (const variant of DERIVATIVE_VARIANTS)
      expect(derivativeKey(original, variant)?.startsWith(original.slice(0, -'original'.length))).toBe(true);
  });

  it('EVM-068 AC2 a key that is not the shape the server assigns (another prefix, a name, a path trick) gets no derivative key', () => {
    for (const key of [
      `documents/2026/10/${ID}/original`,
      `media/2026/10/${ID}/original.jpg`,
      `media/2026/10/${ID}/../other/original`,
      'media/2026/10/holiday-photo.jpg',
      '',
      `media/2026/10/${ID}/thumbnail.webp`,
    ]) {
      expect(derivativeKey(key, 'thumbnail'), key).toBeUndefined();
    }
  });

  it('EVM-068 AC6 only a ready file has derivatives; clean is enough for the original and never for a derivative', () => {
    expect(hasDerivatives('ready')).toBe(true);
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'quarantined', 'failed'] as const) {
      expect(hasDerivatives(state), state).toBe(false);
    }
    expect(isDownloadable('clean')).toBe(true);
    expect(hasDerivatives('clean')).toBe(false);
  });

  it('EVM-068 AC3 AC4 the pixel limit, an unsupported file and a bad output are permanent; the timeout, a fault and an unreachable processor are retried', () => {
    for (const code of ['pixel_limit', 'unsupported', 'invalid_output'] as const) expect(isPermanent(code), code).toBe(true);
    for (const code of ['timeout', 'internal', 'unavailable'] as const) expect(isPermanent(code), code).toBe(false);
  });

  it('EVM-068 AC6 the constants of the story: three takes, the stale period of five minutes, WebP, 300 s, the edges 320 and 1600', () => {
    expect(MAX_PROCESSING_ATTEMPTS).toBe(3);
    expect(STALE_PROCESSING_MS).toBe(300_000);
    expect(DERIVATIVE_CONTENT_TYPE).toBe('image/webp');
    expect(DERIVATIVE_URL_SECONDS).toBe(300);
    expect(DERIVATIVE_CACHE_CONTROL).toBe('private, max-age=300');
    expect(VARIANT_EDGES).toEqual({ thumbnail: 320, preview: 1600 });
  });
});
