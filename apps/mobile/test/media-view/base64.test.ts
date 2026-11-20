import { toBase64 } from '../../src/media-view/base64';

describe('toBase64 (EVM-142 AC5: images are held as data addresses in memory)', () => {
  it('EVM-142 AC5: equals the standard encoding for every padding length and for a long array (chunk borders)', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 12288, 12289, 12290, 40000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
