import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  cameraCommands,
  E2E_MEDIA_WORK_ORDER,
  FORBIDDEN_PERMISSION,
  hasBackCamera,
  inspectJpeg,
  isCameraAction,
  judgeBatch,
  judgeGallery,
  judgeOriginalsExif,
  judgePermissions,
  readGallery,
  runCameraAction,
  tiffHasGpsPointer,
} from '../src/device-camera.mjs';
import { runDeviceAction } from '../src/device.mjs';

const APP = 'pl.eviacharge.manager';
const ID = (/** @type {number} */ n) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** @param {number | null} status @param {string} [stdout] @param {string} [stderr] */
const out = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });

// ---- JPEGs made here: the camera of the emulator is not available to node:test, so the reader is judged on files with known content ----

/** @param {number} marker @param {Buffer} payload */
const segment = (marker, payload) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

/**
 * A TIFF structure of an EXIF segment: IFD0 with the given tags (value = the offset or the value field, 4 bytes), optionally a next IFD.
 * @param {{ little?: boolean, tags: number[], exifIfd?: number[], next?: number[] }} spec tags of IFD0 / of the EXIF sub-IFD / of IFD1
 */
function tiff({ little = true, tags, exifIfd, next }) {
  const w16 = (/** @type {Buffer} */ b, /** @type {number} */ v, /** @type {number} */ at) =>
    little ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at);
  const w32 = (/** @type {Buffer} */ b, /** @type {number} */ v, /** @type {number} */ at) =>
    little ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at);
  /** @param {number[]} list @param {number} nextOffset @param {Record<number, number>} [values] */
  const ifd = (list, nextOffset, values = {}) => {
    const b = Buffer.alloc(2 + list.length * 12 + 4);
    w16(b, list.length, 0);
    list.forEach((tag, index) => {
      w16(b, tag, 2 + index * 12);
      w16(b, 3, 4 + index * 12);
      w32(b, 1, 6 + index * 12);
      w32(b, values[tag] ?? 1, 10 + index * 12);
    });
    w32(b, nextOffset, 2 + list.length * 12);
    return b;
  };
  const header = Buffer.from(little ? 'II' : 'MM', 'latin1');
  const rest = Buffer.alloc(6);
  w16(rest, 42, 0);
  w32(rest, 8, 2);
  const ifd0Size = 2 + tags.length * 12 + 4;
  const exifAt = 8 + ifd0Size;
  const exifBuffer = exifIfd === undefined ? Buffer.alloc(0) : ifd(exifIfd, 0);
  const nextAt = exifAt + exifBuffer.length;
  const nextBuffer = next === undefined ? Buffer.alloc(0) : ifd(next, 0);
  const ifd0 = ifd(tags, next === undefined ? 0 : nextAt, { 0x87_69: exifAt });
  return Buffer.concat([header, rest, ifd0, exifBuffer, nextBuffer]);
}

/** @param {Buffer} tiffBytes */
const exifSegment = (tiffBytes) => segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBytes]));
/** @param {string} xml */
const xmpSegment = (xml) =>
  segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'latin1')]));
const SOI = Buffer.from([0xff, 0xd8]);
const SOS_AND_DATA = Buffer.concat([segment(0xda, Buffer.from([1, 2, 3])), Buffer.from([0x12, 0x34, 0xff, 0xd9])]);
const JFIF = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
/** @param {Buffer[]} parts */
const jpeg = (...parts) => Buffer.concat([SOI, ...parts, SOS_AND_DATA]);

const ORIENTATION = 0x01_12;
const GPS_IFD = 0x88_25;

describe('the reader of a JPEG: APP1 / EXIF and XMP (EVM-108 AC1; security requirement 21)', () => {
  it('EVM-108 AC1: positive control — a JPEG with a pointer to the GPS IFD in IFD0 is found, in both byte orders', () => {
    for (const little of [true, false]) {
      const found = inspectJpeg(jpeg(JFIF, exifSegment(tiff({ little, tags: [ORIENTATION, GPS_IFD] }))));
      assert.deepEqual(found, { valid: true, exifSegments: 1, xmpSegments: 0, gpsPointer: true, xmpGps: false });
    }
  });

  it('EVM-108 AC1: positive control — the pointer is found also in the next IFD and under the EXIF sub-IFD, and GPS in an XMP packet is found', () => {
    assert.equal(inspectJpeg(jpeg(exifSegment(tiff({ tags: [ORIENTATION], next: [GPS_IFD] })))).gpsPointer, true);
    assert.equal(inspectJpeg(jpeg(exifSegment(tiff({ tags: [ORIENTATION, 0x87_69], exifIfd: [GPS_IFD] })))).gpsPointer, true);
    const xmp = inspectJpeg(jpeg(xmpSegment('<x:xmpmeta><rdf:Description exif:GPSLatitude="52,13.5N"/></x:xmpmeta>')));
    assert.deepEqual(xmp, { valid: true, exifSegments: 0, xmpSegments: 1, gpsPointer: false, xmpGps: true });
    assert.equal(inspectJpeg(jpeg(xmpSegment('<exif:GPSLongitude>21,0.7E</exif:GPSLongitude>'))).xmpGps, true);
  });

  it('EVM-108 AC1: a JPEG with an EXIF segment that has no GPS (orientation, time) and an XMP packet without a location is clean', () => {
    const found = inspectJpeg(
      jpeg(JFIF, exifSegment(tiff({ tags: [ORIENTATION, 0x01_32], exifIfd: [0x90_03], next: [0x01_03] })), xmpSegment('<x:xmpmeta/>')),
    );
    assert.deepEqual(found, { valid: true, exifSegments: 1, xmpSegments: 1, gpsPointer: false, xmpGps: false });
    // the synthetic picture of the hook has no APP1 at all
    assert.deepEqual(inspectJpeg(jpeg(JFIF)), { valid: true, exifSegments: 0, xmpSegments: 0, gpsPointer: false, xmpGps: false });
  });

  it('EVM-108 AC1: a structure that does not parse is never called clean (fail closed)', () => {
    assert.equal(inspectJpeg(Buffer.from('not a jpeg')).valid, false);
    assert.equal(inspectJpeg(Buffer.alloc(0)).valid, false);
    // a segment longer than the file, a segment of length 1, a byte that is no marker
    assert.equal(inspectJpeg(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff, 1, 2])])).valid, false);
    assert.equal(inspectJpeg(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x00, 0x01, 1, 2])])).valid, false);
    assert.equal(inspectJpeg(Buffer.concat([SOI, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])])).valid, false);
    // an EXIF segment whose TIFF is cut short or has no byte order mark
    assert.equal(inspectJpeg(jpeg(exifSegment(Buffer.from('II*\0')))).valid, false);
    assert.equal(inspectJpeg(jpeg(exifSegment(Buffer.from('XX*\0\x08\0\0\0\0\0\0\0')))).valid, false);
    assert.equal(tiffHasGpsPointer(Buffer.from('MM')), null);
    // an IFD that points to itself ends (no loop), the depth is bounded
    const loop = tiff({ tags: [ORIENTATION] });
    loop.writeUInt32LE(8, 8 + 2 + 12);
    assert.equal(tiffHasGpsPointer(loop), false);
  });

  it('EVM-108 AC1: fill bytes and markers without a length between the segments are skipped; the end of the image ends the reading', () => {
    const odd = Buffer.concat([SOI, Buffer.from([0xff, 0xff, 0xff, 0x01]), JFIF, Buffer.from([0xff, 0xd9])]);
    assert.equal(inspectJpeg(odd).valid, true);
    const restart = Buffer.concat([SOI, Buffer.from([0xff, 0xd0]), JFIF, Buffer.from([0xff, 0xd9])]);
    assert.equal(inspectJpeg(restart).valid, true);
    // a GPS pointer AFTER the start of the scan is not a header: not read
    assert.equal(inspectJpeg(Buffer.concat([SOI, JFIF, SOS_AND_DATA, exifSegment(tiff({ tags: [GPS_IFD] }))])).gpsPointer, false);
  });

  it('EVM-108 AC1: the originals are judged together — the count must match, every one must be readable, a single GPS fails the step, the text carries counts only', () => {
    const clean = jpeg(JFIF, exifSegment(tiff({ tags: [ORIENTATION] })));
    const dirty = jpeg(JFIF, exifSegment(tiff({ tags: [GPS_IFD] })));
    const good = judgeOriginalsExif({ [ID(1)]: clean, [ID(2)]: jpeg(JFIF) }, 2);
    assert.equal(good.ok, true);
    assert.match(good.detail, /2 original\(s\): 1 with an EXIF segment, 0 with a GPS IFD pointer, 0 with exif:GPS in XMP, 0 unreadable/);
    const found = judgeOriginalsExif({ [ID(1)]: clean, [ID(2)]: dirty }, 2);
    assert.equal(found.ok, false);
    assert.match(found.detail, /1 with a GPS IFD pointer/);
    assert.equal(judgeOriginalsExif({ [ID(1)]: jpeg(xmpSegment('exif:GPSLatitude')) }, 1).ok, false);
    assert.equal(judgeOriginalsExif({ [ID(1)]: null }, 1).ok, false);
    assert.equal(judgeOriginalsExif({ [ID(1)]: Buffer.from('nope') }, 1).ok, false);
    assert.match(judgeOriginalsExif({ [ID(1)]: clean }, 3).detail, /1 original\(s\) on the device, 3 expected/);
    assert.equal(judgeOriginalsExif({}, 0).ok, true);
    assert.doesNotMatch(found.detail, new RegExp(ID(1)));
  });
});

describe('the gallery and the permissions (EVM-108 AC1, AC3)', () => {
  const rows = (/** @type {number} */ n) =>
    n === 0 ? 'No result found.\n' : Array.from({ length: n }, (_, i) => `Row: ${String(i)} _id=${String(i + 1)}\n`).join('');

  it('EVM-108 AC1: the gallery is read as image rows and files; an answer that is no answer of a query makes the state unreadable', () => {
    assert.deepEqual(readGallery(out(0, rows(2)), out(0, '/sdcard/DCIM/b.jpg\n/sdcard/Pictures/a.jpg\n'), out(0)), {
      images: 2,
      files: ['/sdcard/DCIM/b.jpg', '/sdcard/Pictures/a.jpg'],
    });
    assert.deepEqual(readGallery(out(0, rows(0)), out(0), out(0)), { images: 0, files: [] });
    assert.equal(readGallery(out(0, 'Error: something else\n'), out(0), out(0)), null);
    assert.equal(readGallery(out(1, rows(0)), out(0), out(0)), null);
    assert.equal(readGallery(out(0, rows(0)), out(1), out(0)), null);
    // the folders must exist, or the proof would be empty
    assert.equal(readGallery(out(0, rows(0)), out(0), out(1, '', 'No such file or directory')), null);
  });

  it('EVM-108 AC1: a new image row or a new file in the public folders fails the step; the same state passes; the text has counts only', () => {
    const before = { images: 1, files: ['/sdcard/DCIM/a.jpg'] };
    assert.equal(judgeGallery(before, { images: 1, files: ['/sdcard/DCIM/a.jpg'] }).ok, true);
    const row = judgeGallery(before, { images: 2, files: ['/sdcard/DCIM/a.jpg'] });
    assert.equal(row.ok, false);
    assert.match(row.detail, /image rows 1 -> 2/);
    const file = judgeGallery(before, { images: 1, files: ['/sdcard/DCIM/a.jpg', '/sdcard/Pictures/x.jpg'] });
    assert.equal(file.ok, false);
    assert.doesNotMatch(file.detail, /x\.jpg|a\.jpg/);
    assert.equal(judgeGallery(before, { images: 1, files: ['/sdcard/DCIM/other.jpg'] }).ok, false);
  });

  it('EVM-108 AC1 AC3: the app requests no location, microphone or storage permission; the camera alone is fine; a dump of another package is no proof', () => {
    const dump = (/** @type {string[]} */ ...permissions) =>
      out(
        0,
        [
          `Package [${APP}] (1a2b3c):`,
          '  requested permissions:',
          ...permissions.map((name) => `    ${name}`),
          '  install permissions:',
          '',
        ].join('\n'),
      );
    assert.equal(judgePermissions(dump('android.permission.CAMERA', 'android.permission.INTERNET')).ok, true);
    for (const forbidden of [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.ACCESS_MEDIA_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]) {
      const judged = judgePermissions(dump('android.permission.CAMERA', forbidden));
      assert.equal(judged.ok, false, forbidden);
      assert.ok(judged.detail.includes(forbidden), forbidden);
      assert.match(forbidden, FORBIDDEN_PERMISSION);
    }
    assert.equal(judgePermissions(out(1)).ok, false);
    assert.equal(judgePermissions(out(0, 'Package [other.app] (x):\n')).ok, false);
  });

  it('EVM-108 AC1: a back camera is there only when the device reports android.hardware.camera itself (not .front, not .any)', () => {
    assert.equal(hasBackCamera(out(0, 'feature:android.hardware.camera.front\nfeature:android.hardware.camera.any\n')), false);
    assert.equal(
      hasBackCamera(
        out(0, 'feature:android.hardware.camera.front\nfeature:android.hardware.camera\nfeature:android.hardware.camera.autofocus\n'),
      ),
      true,
    );
    assert.equal(hasBackCamera(out(1, 'feature:android.hardware.camera\n')), false);
  });
});

describe('the batch checkpoint (EVM-108 AC7)', () => {
  const sha = (/** @type {number} */ n) => createHash('sha256').update(String(n)).digest('hex');
  /** @param {number} n @param {{ order?: string, objects?: number, same?: boolean }} [options] */
  const batch = (n, { order = E2E_MEDIA_WORK_ORDER, objects = 1, same = false } = {}) => ({
    assets: Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        ID(i + 1),
        {
          workOrderId: order,
          state: 'uploaded',
          objects,
          sha256: sha(same ? 0 : i),
          declaredSize: 300,
          sessions: 2,
          activeParts: 0,
          partCount: 1,
        },
      ]),
    ),
    orphanedMultiparts: 0,
    openMultiparts: 0,
    counters: { partsReplaced: 1 },
  });
  const locals = (/** @type {number} */ n, same = false) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [ID(i + 1), sha(same ? 0 : i)]));

  it('EVM-108 AC7: 30 objects in the right work order, one per asset, equal SHA-256, no two alike and nothing orphaned pass', () => {
    const judged = judgeBatch(batch(30), locals(30), 30, E2E_MEDIA_WORK_ORDER);
    assert.equal(judged.ok, true);
    assert.match(
      judged.detail,
      /30 object\(s\) in the right work order, one per asset, SHA-256 equal to the original, 0 duplicates, 0 orphaned multiparts \(1 part\(s\) sent again\)/,
    );
  });

  it('EVM-108 AC7: a missing asset, an object in another work order, a second object of one asset, a duplicate content, a changed original and a leftover multipart each fail', () => {
    assert.match(judgeBatch(batch(29), locals(29), 30, E2E_MEDIA_WORK_ORDER).detail, /29 asset\(s\) at the server, 30 expected/);
    assert.match(judgeBatch(batch(3, { order: ID(99) }), locals(3), 3, E2E_MEDIA_WORK_ORDER).detail, /3 asset\(s\) in another work order/);
    const twice = judgeBatch(batch(3, { objects: 2 }), locals(3), 3, E2E_MEDIA_WORK_ORDER);
    assert.equal(twice.ok, false);
    assert.match(twice.detail, /6 object\(s\) at the server, 3 expected/);
    assert.match(twice.detail, /exactly 1\)/);
    assert.match(
      judgeBatch(batch(3, { same: true }), locals(3, true), 3, E2E_MEDIA_WORK_ORDER).detail,
      /2 object\(s\) with the SHA-256 of another one \(a duplicate\)/,
    );
    assert.match(
      judgeBatch(batch(2), { ...locals(2), [ID(1)]: sha(77) }, 2, E2E_MEDIA_WORK_ORDER).detail,
      /differs from SHA-256 of the original/,
    );
    assert.match(judgeBatch({ ...batch(2), orphanedMultiparts: 1 }, locals(2), 2, E2E_MEDIA_WORK_ORDER).detail, /1 orphaned multipart/);
    assert.match(judgeBatch({ ...batch(2), openMultiparts: 1 }, locals(2), 2, E2E_MEDIA_WORK_ORDER).detail, /1 open multipart/);
  });

  it('EVM-108 AC7: the work order of the synthetic files is the one the hook of the app uses (and the order ZL-E2E-1 of the scenario server)', () => {
    const panel = readFileSync(join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile', 'src', 'e2e-hooks', 'panel.tsx'), 'utf8');
    assert.ok(panel.includes(`export const E2E_MEDIA_WORK_ORDER = '${E2E_MEDIA_WORK_ORDER}';`));
    assert.match(panel, /E2E_CAPTURE_MAX = 60/);
  });
});

/**
 * A fake device: adb answers by the first substring of the joined arguments that matches (an array answers in turn), every call is recorded.
 * @param {{ adb?: Record<string, ReturnType<typeof out> | ReturnType<typeof out>[]>, control?: (method: string, path: string) => { status: number, body: unknown } | null, memory?: boolean }} [setup]
 */
function fake({ adb = {}, control, memory = true } = {}) {
  /** @type {string[]} */
  const calls = [];
  const context = {
    adb: (/** @type {string[]} */ ...args) => {
      const line = args.join(' ');
      calls.push(line);
      for (const [needle, answer] of Object.entries(adb)) {
        if (!line.includes(needle)) continue;
        return Array.isArray(answer)
          ? answer.length > 1
            ? /** @type {ReturnType<typeof out>} */ (answer.shift())
            : /** @type {ReturnType<typeof out>} */ (answer[0])
          : answer;
      }
      return out(0);
    },
    sleep: () => Promise.resolve(),
    ...(memory ? { memory: new Map() } : {}),
    ...(control === undefined
      ? {}
      : { uploadControl: (/** @type {string} */ method, /** @type {string} */ path) => Promise.resolve(control(method, path)) }),
  };
  return { context, calls };
}

describe('camera device steps (EVM-108 AC1, AC3, AC7)', () => {
  const GALLERY = {
    'content query': out(0, 'No result found.\n'),
    'find /sdcard': out(0, ''),
    'ls -d /sdcard': out(0, '/sdcard/DCIM\n/sdcard/Pictures\n'),
  };

  it('EVM-108 AC1: the builders are fixed text; the only value in a shell string is a checked asset id', () => {
    assert.deepEqual(cameraCommands.permission(true), ['shell', 'pm', 'grant', APP, 'android.permission.CAMERA']);
    assert.deepEqual(cameraCommands.permission(false), ['shell', 'pm', 'revoke', APP, 'android.permission.CAMERA']);
    assert.deepEqual(cameraCommands.geoFix(), ['emu', 'geo', 'fix', '21.0122', '52.2297']);
    assert.deepEqual(cameraCommands.listOriginals(), ['shell', `run-as ${APP} ls no_backup/evia-upload/originals`]);
    assert.deepEqual(cameraCommands.readOriginal(ID(1)), ['shell', `run-as ${APP} base64 no_backup/evia-upload/originals/${ID(1)}`]);
    assert.throws(() => cameraCommands.readOriginal('1; rm -rf /'), /not an asset id/);
    assert.deepEqual(cameraCommands.dumpsysPackage(), ['shell', 'dumpsys', 'package', APP]);
  });

  it('EVM-108 AC3: the names are camera steps (with or without a value), the other steps are not', () => {
    for (const name of [
      'camera-grant',
      'camera-revoke',
      'camera-geo-fix',
      'gallery-baseline',
      'gallery-unchanged',
      'permissions-minimal',
      'original-exif-clean:2',
      'upload-checkpoint-many:30',
    ])
      assert.equal(isCameraAction(name), true, name);
    for (const name of ['kill-9', 'upload-checkpoint:4', 'original-present']) assert.equal(isCameraAction(name), false, name);
  });

  it('EVM-108 AC3: grant and revoke of the permission, the location of the emulator (a refusal of the console is a failure)', async () => {
    const device = fake();
    assert.equal((await runCameraAction('camera-grant', device.context)).detail, 'permission for the camera granted');
    assert.equal((await runCameraAction('camera-revoke', device.context)).detail, 'permission for the camera revoked');
    assert.equal((await runCameraAction('camera-geo-fix', device.context)).ok, true);
    assert.equal((await runCameraAction('camera-geo-fix', fake({ adb: { 'emu geo': out(0, 'KO: unknown\n') } }).context)).ok, false);
    assert.equal((await runCameraAction('camera-geo-fix', fake({ adb: { 'emu geo': out(1) } }).context)).ok, false);
    assert.equal((await runCameraAction('camera-grant', fake({ adb: { 'pm grant': out(1) } }).context)).ok, false);
  });

  it('EVM-108 AC1: the gallery step keeps a baseline in the memory of the run and compares it later; without a baseline or without a reading it fails', async () => {
    const device = fake({ adb: GALLERY });
    assert.equal((await runCameraAction('gallery-unchanged', device.context)).ok, false);
    assert.match((await runCameraAction('gallery-baseline', device.context)).detail, /baseline: 0 image row\(s\)/);
    assert.equal((await runCameraAction('gallery-unchanged', device.context)).ok, true);
    const changed = fake({ adb: { ...GALLERY, 'content query': [out(0, 'No result found.\n'), out(0, 'Row: 0 _id=1\n')] } });
    await runCameraAction('gallery-baseline', changed.context);
    const after = await runCameraAction('gallery-unchanged', changed.context);
    assert.equal(after.ok, false);
    assert.match(after.detail, /CHANGED/);
    assert.equal((await runCameraAction('gallery-baseline', fake({ adb: { ...GALLERY, 'ls -d /sdcard': out(1) } }).context)).ok, false);
    assert.equal((await runCameraAction('gallery-baseline', fake({ adb: GALLERY, memory: false }).context)).ok, false);
    const unreadable = fake({ adb: { ...GALLERY, 'find /sdcard': [out(0, ''), out(1)] } });
    await runCameraAction('gallery-baseline', unreadable.context);
    assert.equal((await runCameraAction('gallery-unchanged', unreadable.context)).ok, false);
  });

  it('EVM-108 AC1 AC3: the permissions step reads dumpsys package', async () => {
    const good = fake({
      adb: { 'dumpsys package': out(0, `Package [${APP}] (1):\n  requested permissions:\n    android.permission.CAMERA\n`) },
    });
    assert.equal((await runCameraAction('permissions-minimal', good.context)).ok, true);
    const bad = fake({
      adb: { 'dumpsys package': out(0, `Package [${APP}] (1):\n    android.permission.ACCESS_FINE_LOCATION: granted=true\n`) },
    });
    assert.equal((await runCameraAction('permissions-minimal', bad.context)).ok, false);
  });

  /** The device with two originals: the listing and the base64 of each file. */
  const withOriginals = (/** @type {Buffer[]} */ files, /** @type {string} */ features = 'feature:android.hardware.camera\n') =>
    fake({
      adb: {
        'pm list features': out(0, features),
        'ls no_backup/evia-upload/originals\n': out(0),
        ...Object.fromEntries(
          files.map((bytes, i) => [
            `base64 no_backup/evia-upload/originals/${ID(i + 1)}`,
            out(0, `${bytes.toString('base64').replaceAll(/(.{76})/g, '$1\n')}\n`),
          ]),
        ),
        'ls no_backup/evia-upload/originals': out(0, `${files.map((_, i) => ID(i + 1)).join('\n')}\nnot-an-asset\n`),
      },
    });

  it('EVM-108 AC1: the originals step reads the files as base64 through run-as and judges them — clean passes, a GPS pointer fails, with the file count checked', async () => {
    const clean = jpeg(JFIF, exifSegment(tiff({ tags: [ORIENTATION] })));
    const dirty = jpeg(JFIF, exifSegment(tiff({ tags: [ORIENTATION, GPS_IFD] })));
    const ok = await runCameraAction('original-exif-clean:2', withOriginals([clean, clean]).context);
    assert.equal(ok.ok, true);
    assert.equal(ok.skipped, undefined);
    assert.match(ok.detail, /2 original\(s\): 2 with an EXIF segment, 0 with a GPS IFD pointer/);
    const found = await runCameraAction('original-exif-clean:2', withOriginals([clean, dirty]).context);
    assert.equal(found.ok, false);
    assert.match(found.detail, /1 with a GPS IFD pointer/);
    assert.equal((await runCameraAction('original-exif-clean:3', withOriginals([clean, clean]).context)).ok, false);
    assert.equal((await runCameraAction('original-exif-clean', withOriginals([clean]).context)).ok, false);
    const unlisted = fake({ adb: { 'pm list features': out(0, 'feature:android.hardware.camera\n'), 'ls no_backup': out(1) } });
    assert.equal((await runCameraAction('original-exif-clean:1', unlisted.context)).ok, false);
    const unreadable = withOriginals([clean]);
    const base = unreadable.context.adb;
    unreadable.context.adb = (...args) => (args.join(' ').includes('base64') ? out(1) : base(...args));
    assert.equal((await runCameraAction('original-exif-clean:1', unreadable.context)).ok, false);
  });

  it('EVM-108 AC1: without a back camera the step says "not performed" — a skipped step, never an ok one — and reads no file', async () => {
    const device = withOriginals([jpeg(JFIF)], 'feature:android.hardware.camera.front\n');
    const skipped = await runCameraAction('original-exif-clean:1', device.context);
    assert.equal(skipped.skipped, true);
    assert.match(skipped.detail, /^NOT PERFORMED/);
    assert.equal(
      device.calls.some((line) => line.includes('base64')),
      false,
    );
    // through the dispatcher of the run, the verdict keeps the mark
    const viaRun = await runDeviceAction('original-exif-clean:1', device.context);
    assert.equal(viaRun.skipped, true);
  });

  /** A control port with a checkpoint of `n` assets that fills up: the first reads show fewer objects. */
  it('EVM-108 AC7: the batch step waits until every asset has its object, reads the original of each, and judges the whole', async () => {
    const full = {
      assets: Object.fromEntries(
        Array.from({ length: 3 }, (_, i) => [
          ID(i + 1),
          {
            workOrderId: E2E_MEDIA_WORK_ORDER,
            state: 'uploaded',
            objects: 1,
            sha256: createHash('sha256').update(String(i)).digest('hex'),
            declaredSize: 1,
            sessions: 1,
            activeParts: 0,
            partCount: 1,
          },
        ]),
      ),
      orphanedMultiparts: 0,
      openMultiparts: 0,
      counters: {},
    };
    const early = { ...full, assets: { [ID(1)]: full.assets[ID(1)] } };
    const answers = [early, early, full];
    const device = fake({
      control: () => ({ status: 200, body: answers.length > 1 ? answers.shift() : answers[0] }),
      adb: Object.fromEntries(
        [1, 2, 3].map((n) => [
          `sha256sum no_backup/evia-upload/originals/${ID(n)}`,
          out(
            0,
            `${createHash('sha256')
              .update(String(n - 1))
              .digest('hex')}  file\n`,
          ),
        ]),
      ),
    });
    const judged = await runCameraAction('upload-checkpoint-many:3', device.context);
    assert.equal(judged.ok, true, judged.detail);
    assert.match(judged.detail, /^3 object\(s\) in the right work order/);
    const wrong = fake({
      control: () => ({
        status: 200,
        body: {
          ...full,
          assets: Object.fromEntries(Object.entries(full.assets).map(([id, asset]) => [id, { ...asset, workOrderId: ID(50) }])),
        },
      }),
      adb: Object.fromEntries(
        [1, 2, 3].map((n) => [
          `sha256sum no_backup/evia-upload/originals/${ID(n)}`,
          out(
            0,
            `${createHash('sha256')
              .update(String(n - 1))
              .digest('hex')}  file\n`,
          ),
        ]),
      ),
    });
    assert.match((await runCameraAction('upload-checkpoint-many:3', wrong.context)).detail, /3 asset\(s\) in another work order/);
    assert.equal((await runCameraAction('upload-checkpoint-many:3', fake({ control: () => null }).context)).ok, false);
    assert.equal((await runCameraAction('upload-checkpoint-many', device.context)).ok, false);
    assert.equal((await runCameraAction('upload-checkpoint-many:0', device.context)).ok, false);
    assert.equal((await runCameraAction('not-a-camera-step', device.context)).ok, false);
  });
});
