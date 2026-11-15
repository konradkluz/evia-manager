import { describe, expect, it } from 'vitest';
import { checkDeclaration } from '../../src/modules/media/domain/file-rules.ts';
import { checkSessionDeclaration, sameDeclaration } from '../../src/modules/media/domain/upload-declaration.ts';

const SHA = 'a'.repeat(64);
const photo = (over: Record<string, unknown> = {}) => ({
  fileName: '0193a000-0000-7000-8000-000000000001.jpg',
  declaredSize: 2048,
  contentType: 'image/jpeg',
  sha256: SHA,
  ...over,
});

describe('the declaration of a file in the upload session of a medium of the phone (EVM-131 AC1; SR-FILE-01, SR-FILE-03)', () => {
  it('EVM-131 AC1 a valid photo and a valid video are accepted with the cleaned name; the key of the object is never derived from it', () => {
    expect(checkSessionDeclaration(photo({ fileName: 'a/b\\IMG 1.JPG' }), 'photo')).toEqual({
      ok: true,
      value: { contentType: 'image/jpeg', mediaType: 'photo', originalFilename: 'IMG 1.JPG' },
    });
    expect(
      checkSessionDeclaration(photo({ fileName: 'clip.mp4', contentType: 'video/mp4', declaredSize: 4_294_967_296 }), 'video'),
    ).toMatchObject({ ok: true });
  });

  it('EVM-131 AC1 it takes the same limits as the batch of the panel (allow-list, extension, size per kind) - the same function', () => {
    for (const bad of [
      photo({ contentType: 'image/svg+xml', fileName: 'x.svg' }),
      photo({ fileName: 'x.png' }),
      photo({ declaredSize: 52_428_801 }),
      photo({ declaredSize: 0 }),
      photo({ fileName: '../' }),
      photo({ fileName: `${String.fromCodePoint(0x202e)}${String.fromCodePoint(0)}` }),
    ]) {
      expect(checkSessionDeclaration(bad, 'photo').ok, JSON.stringify(bad)).toBe(false);
      expect(checkDeclaration(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    const issues = checkSessionDeclaration(photo({ fileName: 'x.png', declaredSize: 0 }), 'photo');
    expect(issues.ok).toBe(false);
    const found = issues.ok ? [] : issues.issues;
    expect(found).toContainEqual({ pointer: '/file/fileName', code: 'unsupported_type' });
    expect(found).toContainEqual({ pointer: '/file/declaredSize', code: 'size_out_of_range' });
  });

  it('EVM-131 AC1 the type of the file belongs to the kind of the medium: a photo takes no video and a video no photo', () => {
    expect(checkSessionDeclaration(photo({ fileName: 'x.mp4', contentType: 'video/mp4' }), 'photo')).toEqual({
      ok: false,
      issues: [{ pointer: '/file/contentType', code: 'unsupported_type' }],
    });
    expect(checkSessionDeclaration(photo(), 'video')).toEqual({
      ok: false,
      issues: [{ pointer: '/file/contentType', code: 'unsupported_type' }],
    });
  });

  it('EVM-131 AC1 a repeat is recognised by the declared size, the type, the checksum and the cleaned name; any difference is another declaration', () => {
    const declared = photo();
    const checked = checkSessionDeclaration(declared, 'photo');
    if (!checked.ok) throw new Error('fixture');
    const stored = { declaredSize: 2048, declaredContentType: 'image/jpeg', declaredSha256: SHA, originalFilename: declared.fileName };
    expect(sameDeclaration(declared, checked.value, stored)).toBe(true);
    for (const change of [
      { declaredSize: 2049 },
      { declaredContentType: 'image/png' },
      { declaredSha256: 'b'.repeat(64) },
      { originalFilename: 'other.jpg' },
      { originalFilename: null },
    ]) {
      expect(sameDeclaration(declared, checked.value, { ...stored, ...change }), JSON.stringify(change)).toBe(false);
    }
  });
});
