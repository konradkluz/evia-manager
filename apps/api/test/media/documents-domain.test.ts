import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  canRaiseTo,
  effectiveClass,
  isHigher,
  isRaised,
  maxClass,
  mayDownloadDocument,
  resolveNewDocumentClass,
} from '../../src/modules/media/domain/confidentiality.ts';
import {
  checkDocumentDeclaration,
  documentTypeAgrees,
  isDocumentOriginalReleasable,
  isOoxml,
  MAX_DOCUMENT_BYTES,
  normalizeDocumentType,
} from '../../src/modules/media/domain/document-rules.ts';
import { inspectOoxml, MAX_ENTRIES } from '../../src/modules/media/domain/ooxml-inspect.ts';
import { buildOoxml, buildZip, headAndTail } from '../support/zip-builder.ts';

const inspect = (file: Buffer) => {
  const { head, tail, size } = headAndTail(file);
  return inspectOoxml(head, tail, size);
};

describe('EVM-047 AC2 the effective class is the higher of the kind and the override (SR-AUTHZ-07)', () => {
  it('EVM-047 AC2 orders the classes and picks the higher', () => {
    expect(isHigher('identity_data', 'building_security')).toBe(true);
    expect(isHigher('standard', 'standard')).toBe(false);
    expect(maxClass('building_security', 'standard')).toBe('building_security');
    expect(maxClass('standard', 'identity_data')).toBe('identity_data');
    expect(effectiveClass('standard', null)).toBe('standard');
    expect(effectiveClass('building_security', 'identity_data')).toBe('identity_data');
    expect(effectiveClass('identity_data', 'building_security')).toBe('identity_data');
    expect(isRaised('standard', 'building_security')).toBe(true);
    expect(isRaised('identity_data', 'building_security')).toBe(false);
    expect(isRaised('standard', null)).toBe(false);
  });

  it('EVM-047 AC5 only Administrator and Editor take every class; Read-only takes `standard`', () => {
    for (const cls of ['standard', 'building_security', 'identity_data'] as const) {
      expect(mayDownloadDocument('administrator', cls)).toBe(true);
      expect(mayDownloadDocument('editor', cls)).toBe(true);
    }
    expect(mayDownloadDocument('read_only', 'standard')).toBe(true);
    expect(mayDownloadDocument('read_only', 'building_security')).toBe(false);
    expect(mayDownloadDocument('read_only', 'identity_data')).toBe(false);
    expect(mayDownloadDocument('somebody', 'standard')).toBe(false);
  });

  it('EVM-047 AC3 the kind `other` needs the answer; `true` is stored as the override `identity_data`', () => {
    const other = { kindCode: 'other', kindClass: 'standard' } as const;
    expect(resolveNewDocumentClass(other)).toEqual({ ok: false, issues: [{ field: 'containsIdentityData', code: 'required' }] });
    expect(resolveNewDocumentClass({ ...other, containsIdentityData: true })).toEqual({ ok: true, override: 'identity_data' });
    expect(resolveNewDocumentClass({ ...other, containsIdentityData: false })).toEqual({ ok: true, override: null });
    expect(resolveNewDocumentClass({ ...other, containsIdentityData: false, confidentialityOverride: 'building_security' })).toEqual({
      ok: true,
      override: 'building_security',
    });
  });

  it('EVM-047 AC3 the answer about identity data is refused for any other kind', () => {
    const result = resolveNewDocumentClass({ kindCode: 'quote', kindClass: 'standard', containsIdentityData: false });
    expect(result).toEqual({ ok: false, issues: [{ field: 'containsIdentityData', code: 'not_applicable' }] });
  });

  it('EVM-047 AC4 an override equal to or lower than the class of the kind is refused', () => {
    const base = { kindCode: 'installation_design', kindClass: 'building_security' } as const;
    expect(resolveNewDocumentClass({ ...base, confidentialityOverride: 'building_security' })).toEqual({
      ok: false,
      issues: [{ field: 'confidentialityOverride', code: 'not_higher' }],
    });
    expect(resolveNewDocumentClass({ ...base, confidentialityOverride: 'identity_data' })).toEqual({ ok: true, override: 'identity_data' });
    expect(resolveNewDocumentClass({ ...base })).toEqual({ ok: true, override: null });
  });

  it('EVM-047 AC4 a raise must be strictly above the EFFECTIVE class (kind and current override)', () => {
    expect(canRaiseTo('standard', null, 'building_security')).toBe(true);
    expect(canRaiseTo('standard', 'building_security', 'building_security')).toBe(false);
    expect(canRaiseTo('standard', 'building_security', 'identity_data')).toBe(true);
    expect(canRaiseTo('building_security', null, 'building_security')).toBe(false);
    expect(canRaiseTo('identity_data', null, 'identity_data')).toBe(false);
  });
});

describe('EVM-047 AC6 the allow-list of a document (SR-FILE-01, SR-FILE-03)', () => {
  const ok = { fileName: 'warunki.pdf', contentType: 'application/pdf', declaredSize: 2_000_000 };

  it('EVM-047 AC1 accepts PDF, DOCX, XLSX, JPEG and PNG up to 100 MB', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    for (const [fileName, contentType] of [
      ['a.pdf', 'application/pdf'],
      ['a.docx', docx],
      ['a.xlsx', xlsx],
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpg'],
      ['a.png', 'image/png'],
    ] as const) {
      expect(checkDocumentDeclaration({ ...ok, fileName, contentType }).ok).toBe(true);
    }
    expect(checkDocumentDeclaration({ ...ok, declaredSize: MAX_DOCUMENT_BYTES }).ok).toBe(true);
    expect(checkDocumentDeclaration(ok)).toEqual({ ok: true, value: { contentType: 'application/pdf', originalFilename: 'warunki.pdf' } });
  });

  it('EVM-047 AC6 refuses SVG, HTML, archives, macro formats, a wrong extension and the sizes outside the range', () => {
    const issues = (declaration: Parameters<typeof checkDocumentDeclaration>[0]) => {
      const result = checkDocumentDeclaration(declaration);
      return result.ok ? [] : result.issues;
    };
    expect(issues({ ...ok, fileName: 'a.svg', contentType: 'image/svg+xml' })).toContainEqual({
      field: 'contentType',
      code: 'unsupported_type',
    });
    expect(issues({ ...ok, fileName: 'a.html', contentType: 'text/html' })).toContainEqual({
      field: 'contentType',
      code: 'unsupported_type',
    });
    expect(issues({ ...ok, fileName: 'a.zip', contentType: 'application/zip' })).toContainEqual({
      field: 'contentType',
      code: 'unsupported_type',
    });
    expect(issues({ ...ok, fileName: 'a.docm', contentType: 'application/vnd.ms-word.document.macroEnabled.12' })).toContainEqual({
      field: 'contentType',
      code: 'unsupported_type',
    });
    expect(
      issues({ ...ok, fileName: 'a.xlsm', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    ).toContainEqual({ field: 'fileName', code: 'unsupported_type' });
    expect(issues({ ...ok, fileName: 'a.exe' })).toContainEqual({ field: 'fileName', code: 'unsupported_type' });
    expect(issues({ ...ok, declaredSize: MAX_DOCUMENT_BYTES + 1 })).toContainEqual({ field: 'declaredSize', code: 'file_too_large' });
    expect(issues({ ...ok, declaredSize: 0 })).toContainEqual({ field: 'declaredSize', code: 'size_out_of_range' });
    expect(issues({ ...ok, fileName: '   ' })).toContainEqual({ field: 'fileName', code: 'invalid_file_name' });
  });

  it('EVM-047 AC6 the detected type must agree with the declaration and the extension', () => {
    expect(documentTypeAgrees('application/pdf', 'application/pdf', 'a.pdf')).toBe(true);
    expect(documentTypeAgrees('image/png', 'application/pdf', 'a.pdf')).toBe(false);
    expect(documentTypeAgrees('application/pdf', 'application/pdf', 'a.png')).toBe(false);
    expect(documentTypeAgrees(undefined, 'application/pdf', 'a.pdf')).toBe(false);
    expect(documentTypeAgrees('application/x-cfb', 'application/pdf', null)).toBe(false);
    expect(documentTypeAgrees('application/pdf', 'text/html', null)).toBe(false);
    expect(documentTypeAgrees('application/pdf', 'application/pdf', null)).toBe(true);
    expect(normalizeDocumentType(' APPLICATION/PDF ')).toBe('application/pdf');
    expect(isOoxml('application/pdf')).toBe(false);
  });

  it('EVM-047 AC5 only a file that passed the scan is released', () => {
    expect(isDocumentOriginalReleasable('clean')).toBe(true);
    expect(isDocumentOriginalReleasable('ready')).toBe(true);
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'quarantined', 'failed', 'processing']) {
      expect(isDocumentOriginalReleasable(state)).toBe(false);
    }
  });
});

describe('EVM-047 AC6 the inspection of an OOXML file for macros (SR-FILE-03, TM-36)', () => {
  it('EVM-047 AC6 a plain DOCX and a plain XLSX are recognised and have no macros', () => {
    expect(inspect(buildOoxml())).toEqual({ ok: true, kind: 'docx', macros: false });
    expect(inspect(buildOoxml({ kind: 'xlsx' }))).toEqual({ ok: true, kind: 'xlsx', macros: false });
  });

  it('EVM-047 AC6 a macro project, its signature, ActiveX and macro sheets are found by the names of the entries, in any case', () => {
    for (const name of [
      'word/vbaProject.bin',
      'WORD/VBAPROJECT.BIN',
      'word\\vbaProjectSignature.bin',
      'word/vbaData.xml',
      'xl/macrosheets/sheet1.xml',
      'word/activeX/activeX1.xml',
    ]) {
      const result = inspect(buildOoxml({ extra: [{ name, data: 'x' }] }));
      expect(result, name).toEqual({ ok: true, kind: 'docx', macros: true });
    }
  });

  it('EVM-047 AC6 a macro-enabled content type is found in the deflated `[Content_Types].xml`', () => {
    const contentTypes =
      '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>';
    expect(inspect(buildOoxml({ contentTypes }))).toEqual({ ok: true, kind: 'docx', macros: true });
    const stored = buildZip([
      { name: '[Content_Types].xml', data: contentTypes, method: 'store' },
      { name: 'word/document.xml', data: '<d/>' },
    ]);
    expect(inspect(stored)).toEqual({ ok: true, kind: 'docx', macros: true });
    expect(inspect(buildOoxml({ contentTypes: '<Types>vnd.ms-office.vbaProject</Types>' }))).toMatchObject({ ok: true, macros: true });
  });

  it('EVM-047 AC6 a ZIP that is neither a DOCX nor an XLSX has the kind `unknown`', () => {
    const zip = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'a.txt', data: 'x' },
    ]);
    expect(inspect(zip)).toEqual({ ok: true, kind: 'unknown', macros: false });
    const both = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: 'x' },
      { name: 'xl/workbook.xml', data: 'x' },
    ]);
    expect(inspect(both)).toMatchObject({ kind: 'unknown' });
  });

  it('EVM-047 AC6 refuses what is not a ZIP: text, an encrypted (OLE) container, an empty or too short file', () => {
    expect(inspect(Buffer.from('this is not a zip file at all, just some text'))).toEqual({ ok: false, reason: 'not_zip' });
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
    expect(inspect(cfb)).toEqual({ ok: false, reason: 'not_zip' });
    expect(inspect(Buffer.alloc(0))).toEqual({ ok: false, reason: 'not_zip' });
    expect(inspect(Buffer.alloc(10))).toEqual({ ok: false, reason: 'not_zip' });
    expect(inspectOoxml(Buffer.alloc(0), Buffer.alloc(30), 20)).toEqual({ ok: false, reason: 'not_zip' });
  });

  it('EVM-047 AC6 refuses a truncated file (the end record is gone) and a wrong offset of the directory', () => {
    const file = buildOoxml();
    expect(inspect(file.subarray(0, file.length - 10))).toMatchObject({ ok: false });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectoryOffset: 5 }))).toMatchObject({
      ok: false,
    });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectoryOffset: 0x7fffffff }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('EVM-047 AC6 refuses an enormous number of entries and a directory that does not match its header', () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, index) => ({ name: `f${index}.txt`, data: '' }));
    expect(inspect(buildZip(entries))).toEqual({ ok: false, reason: 'limits' });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideCount: 3 }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectorySize: 5000 }))).toMatchObject({
      ok: false,
    });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectorySize: 2 }))).toMatchObject({
      ok: false,
    });
  });

  it('EVM-047 AC6 refuses ZIP64 (a locator and the saturated fields of the end record)', () => {
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { zip64Locator: true }))).toEqual({
      ok: false,
      reason: 'zip64',
    });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideCount: 0xffff }))).toEqual({
      ok: false,
      reason: 'zip64',
    });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectoryOffset: 0xffffffff }))).toEqual({
      ok: false,
      reason: 'zip64',
    });
  });

  it('EVM-047 AC6 refuses an ambiguous archive whose comment imitates a second end record', () => {
    const imitation = buildZip([{ name: 'a.txt', data: 'x' }]).subarray(-22);
    const file = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { comment: imitation });
    expect(inspect(file)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('EVM-047 AC6 refuses a missing or duplicated `[Content_Types].xml`, and entries that leave the archive', () => {
    expect(inspect(buildZip([{ name: 'word/document.xml', data: 'x' }]))).toEqual({ ok: false, reason: 'no_content_types' });
    const twice = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: '[content_types].xml', data: '<Types/>' },
    ]);
    expect(inspect(twice)).toEqual({ ok: false, reason: 'no_content_types' });
    expect(inspect(buildOoxml({ extra: [{ name: '../../evil.bin', data: 'x' }] }))).toEqual({ ok: false, reason: 'malformed' });
    expect(inspect(buildOoxml({ extra: [{ name: 'C:/evil.bin', data: 'x' }] }))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('EVM-047 AC6 refuses a bomb in `[Content_Types].xml` and an entry that is encrypted or uses an unknown method', () => {
    const bomb = '<Types>' + 'a'.repeat(2 * 1_048_576) + '</Types>';
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: bomb }]))).toEqual({ ok: false, reason: 'limits' });
    // a header that claims a small size but whose data inflates beyond the limit
    const hidden = buildZip([{ name: '[Content_Types].xml', data: 'x'.repeat(100) }]);
    const bombData = deflateRawSync(Buffer.alloc(3 * 1_048_576, 0x61));
    const forged = Buffer.concat([hidden.subarray(0, 30 + 19), bombData]);
    expect(inspectOoxml(forged, hidden, hidden.length)).toMatchObject({ ok: false });
    expect(inspect(buildZip([{ name: '[Content_Types].xml', data: '<Types/>', flags: 1 }]))).toEqual({
      ok: false,
      reason: 'unsupported_entry',
    });
    const wrongMethod = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }]);
    const centralAt = wrongMethod.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    wrongMethod.writeUInt16LE(12, centralAt + 10);
    expect(inspect(wrongMethod)).toEqual({ ok: false, reason: 'unsupported_entry' });
  });

  it('EVM-047 AC6 refuses an entry that is outside the bytes the scan kept, a damaged local header and a stored size that lies', () => {
    const file = buildOoxml();
    const { tail, size } = headAndTail(file);
    expect(inspectOoxml(Buffer.alloc(0), tail, size)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(inspectOoxml(file.subarray(0, 40), tail, size)).toMatchObject({ ok: false, reason: 'limits' });
    const stored = buildZip([{ name: '[Content_Types].xml', data: '<Types/>', method: 'store' }]);
    const centralAt = stored.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    stored.writeUInt32LE(3, centralAt + 24);
    expect(inspect(stored)).toEqual({ ok: false, reason: 'malformed' });
    const damaged = buildOoxml();
    damaged.writeUInt32LE(0, 0);
    expect(inspect(damaged)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('EVM-047 AC6 a directory that starts before the kept tail cannot be judged', () => {
    const file = buildOoxml();
    const { head, size } = headAndTail(file);
    expect(inspectOoxml(head, file.subarray(file.length - 30), size)).toEqual({ ok: false, reason: 'limits' });
  });
});
