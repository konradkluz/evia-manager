import { describe, expect, it } from 'vitest';
import { documentDownloadName } from '../../src/modules/media/domain/document-rules.ts';
import { judgeDocument } from '../../src/modules/media/domain/document-scan.ts';
import { inspectOoxml } from '../../src/modules/media/domain/ooxml-inspect.ts';
import { documentObjectKeyFor } from '../../src/modules/media/domain/upload-plan.ts';
import { buildOoxml, buildZip, headAndTail } from '../support/zip-builder.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const inspect = (file: Buffer) => {
  const { head, tail, size } = headAndTail(file);
  return inspectOoxml(head, tail, size);
};

describe('EVM-047 AC6 the verdict on the type of a scanned document (SR-FILE-03, SR-FILE-06)', () => {
  const pdfFacts = {
    declaredType: 'application/pdf',
    fileName: 'a.pdf' as string | null,
    detectedMime: 'application/pdf' as string | undefined,
    head: Buffer.alloc(0),
    tail: Buffer.alloc(0),
    size: 10,
  };
  const ooxml = (file: Buffer, over: Partial<Parameters<typeof judgeDocument>[0]> = {}) => {
    const { head, tail, size } = headAndTail(file);
    return judgeDocument({ declaredType: DOCX, fileName: 'a.docx', detectedMime: 'application/zip', head, tail, size, ...over });
  };

  it('EVM-047 AC6 a PDF, a JPEG and a PNG agree only with what was declared, and the stored type is the detected one', () => {
    expect(judgeDocument(pdfFacts)).toEqual({ typeMatches: true, contentType: 'application/pdf' });
    expect(judgeDocument({ ...pdfFacts, detectedMime: 'image/png' })).toEqual({ typeMatches: false, contentType: 'image/png' });
    expect(judgeDocument({ ...pdfFacts, detectedMime: undefined })).toEqual({ typeMatches: false, contentType: null });
    expect(judgeDocument({ ...pdfFacts, detectedMime: 'application/x-cfb' })).toEqual({ typeMatches: false, contentType: null });
    expect(judgeDocument({ ...pdfFacts, fileName: 'a.png' }).typeMatches).toBe(false);
    expect(judgeDocument({ ...pdfFacts, fileName: null }).typeMatches).toBe(true);
  });

  it('EVM-047 AC6 a declared type outside the list never agrees', () => {
    expect(judgeDocument({ ...pdfFacts, declaredType: 'text/html' })).toEqual({ typeMatches: false, contentType: 'application/pdf' });
    expect(judgeDocument({ ...pdfFacts, declaredType: 'text/html', detectedMime: undefined })).toEqual({
      typeMatches: false,
      contentType: null,
    });
  });

  it('EVM-047 AC6 a plain DOCX and a plain XLSX agree, whether file-type saw a ZIP or already the Office type', () => {
    expect(ooxml(buildOoxml())).toEqual({ typeMatches: true, contentType: DOCX });
    expect(ooxml(buildOoxml(), { detectedMime: DOCX })).toEqual({ typeMatches: true, contentType: DOCX });
    expect(ooxml(buildOoxml({ kind: 'xlsx' }), { declaredType: XLSX, fileName: 'a.xlsx' })).toEqual({
      typeMatches: true,
      contentType: XLSX,
    });
    expect(ooxml(buildOoxml(), { fileName: null })).toEqual({ typeMatches: true, contentType: DOCX });
  });

  it('EVM-047 AC6 a macro, the other Office kind, a wrong extension, an OLE container and a file that is not a ZIP are mismatches', () => {
    expect(ooxml(buildOoxml({ extra: [{ name: 'word/vbaProject.bin', data: 'x' }] })).typeMatches).toBe(false);
    expect(ooxml(buildOoxml({ kind: 'xlsx' })).typeMatches).toBe(false); // declared DOCX, content XLSX
    expect(ooxml(buildOoxml(), { declaredType: XLSX, fileName: 'a.xlsx' }).typeMatches).toBe(false); // declared XLSX, content DOCX
    expect(ooxml(buildOoxml(), { fileName: 'a.docm' }).typeMatches).toBe(false);
    expect(ooxml(buildOoxml(), { detectedMime: 'application/x-cfb' })).toEqual({ typeMatches: false, contentType: null });
    expect(ooxml(buildOoxml(), { detectedMime: XLSX })).toEqual({ typeMatches: false, contentType: XLSX });
    expect(ooxml(Buffer.from('plain text, not a zip at all '.repeat(10)), { detectedMime: 'application/zip' }).typeMatches).toBe(false);
    expect(ooxml(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }])).typeMatches).toBe(false); // neither word nor xl
  });

  it('EVM-047 AC5 the name under which the browser saves a document: the cleaned stored name, else a fallback from the id and the detected type', () => {
    const id = '0190a1b2-0000-7000-8000-00000000d001';
    expect(documentDownloadName('Pismo "nr 7".pdf', id, 'application/pdf')).toBe('Pismo nr 7.pdf');
    expect(documentDownloadName(null, id, 'application/pdf')).toBe('dokument-0190a1b2.pdf');
    expect(documentDownloadName('"";;', id, DOCX)).toBe('dokument-0190a1b2.docx');
    expect(documentDownloadName(null, id, null)).toBe('dokument-0190a1b2.bin');
    expect(documentDownloadName(null, id, 'text/html')).toBe('dokument-0190a1b2.bin');
  });

  it('EVM-047 AC1 the key of the object of a document is assigned by the server, under documents/, with no name and no order number', () => {
    expect(documentObjectKeyFor('0190a1b2-0000-7000-8000-00000000d001', new Date('2026-10-31T08:00:00Z'))).toBe(
      'documents/2026/10/0190a1b2-0000-7000-8000-00000000d001/original',
    );
  });
});

describe('EVM-047 AC6 the inspector refuses every forged header of a ZIP (fail closed)', () => {
  const small = () =>
    buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: 'x' },
    ]);
  const at = (file: Buffer, signature: number[]) => file.indexOf(Buffer.from(signature));
  const CENTRAL = [0x50, 0x4b, 0x01, 0x02];
  const END = [0x50, 0x4b, 0x05, 0x06];

  it('EVM-047 AC6 a name longer than the directory, saturated sizes, an offset outside the file and a count smaller than the entries', () => {
    const longName = small();
    longName.writeUInt16LE(0xffff, at(longName, CENTRAL) + 28);
    expect(inspect(longName)).toEqual({ ok: false, reason: 'malformed' });
    const saturatedSize = small();
    saturatedSize.writeUInt32LE(0xffffffff, at(saturatedSize, CENTRAL) + 20);
    expect(inspect(saturatedSize)).toEqual({ ok: false, reason: 'zip64' });
    const saturatedOffset = small();
    saturatedOffset.writeUInt32LE(0xffffffff, at(saturatedOffset, CENTRAL) + 42);
    expect(inspect(saturatedOffset)).toEqual({ ok: false, reason: 'zip64' });
    const outside = small();
    outside.writeUInt32LE(outside.length + 10, at(outside, CENTRAL) + 42);
    expect(inspect(outside)).toEqual({ ok: false, reason: 'malformed' });
    const fewer = buildZip(
      [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: 'x' },
      ],
      { overrideCount: 1 },
    );
    expect(inspect(fewer)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('EVM-047 AC6 a multi-disk archive, a directory above 1 MiB and a comment that only looks like an end record', () => {
    const disk = small();
    disk.writeUInt16LE(1, at(disk, END) + 4);
    expect(inspect(disk)).toEqual({ ok: false, reason: 'malformed' });
    const perDisk = small();
    perDisk.writeUInt16LE(1, at(perDisk, END) + 8);
    expect(inspect(perDisk)).toEqual({ ok: false, reason: 'malformed' });
    const huge = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }], { overrideDirectorySize: 1_048_577 });
    expect(inspect(huge)).toEqual({ ok: false, reason: 'limits' });
    // a comment that carries the signature of an end record with a wrong length: the real record is still the only one
    const decoy = Buffer.concat([Buffer.from(END), Buffer.alloc(30, 7)]);
    const file = buildZip(
      [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: 'x' },
      ],
      { comment: decoy },
    );
    expect(inspect(file)).toEqual({ ok: true, kind: 'docx', macros: false });
  });
});
