import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boxesOf, judgeFilm, readMp4 } from '../src/mp4.mjs';

// ---- films made here: the camera of the emulator is not available to node:test, so the reader is judged on files with known content ----

/** @param {string} type @param {Buffer | Buffer[]} [payload] */
const box = (type, payload = Buffer.alloc(0)) => {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const ftyp = () => box('ftyp', Buffer.concat([Buffer.from('isom', 'latin1'), Buffer.alloc(4), Buffer.from('isomiso2mp41', 'latin1')]));
/** `hdlr`: version/flags, pre_defined, the handler type, 12 reserved bytes, a name. @param {string} handler */
const hdlr = (handler) =>
  box(
    'hdlr',
    Buffer.concat([Buffer.alloc(4), Buffer.alloc(4), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('h\0', 'latin1')]),
  );
/** @param {string} handler */
const track = (handler) => box('trak', [box('tkhd', Buffer.alloc(84)), box('mdia', [box('mdhd', Buffer.alloc(24)), hdlr(handler)])]);
/** The film of the camera: ftyp, mdat, moov with the given tracks and extra atoms in `udta`. @param {string[]} handlers @param {Buffer[]} [udta] */
const film = (handlers, udta = []) =>
  Buffer.concat([
    ftyp(),
    box('mdat', Buffer.alloc(1000, 7)),
    box('moov', [box('mvhd', Buffer.alloc(100)), ...handlers.map(track), ...(udta.length === 0 ? [] : [box('udta', udta)])]),
  ]);

describe('the reader of MP4 boxes (EVM-110 AC1; SEC-110-04)', () => {
  it('EVM-110 AC1: a film with a track of video and nothing else is fine - the handlers are read from the tracks, the brand from ftyp', () => {
    const facts = readMp4(film(['vide']));
    assert.deepEqual(facts, {
      valid: true,
      brand: 'isom',
      topLevel: ['ftyp', 'mdat', 'moov'],
      hasMoov: true,
      handlers: ['vide'],
      location: [],
    });
    assert.deepEqual(judgeFilm(film(['vide'])), { judged: true, ok: true, detail: 'tracks: vide; no sound track, no location atom' });
  });

  it('EVM-110 AC1: the POSITIVE CONTROL - a film WITH a track of sound is found (soun), also next to the video; a reader that finds nothing would pass every file', () => {
    const facts = readMp4(film(['vide', 'soun']));
    assert.deepEqual(facts.handlers, ['vide', 'soun']);
    const judged = judgeFilm(film(['vide', 'soun']));
    assert.equal(judged.ok, false);
    assert.match(judged.detail, /SOUND track \(soun\)/);
    assert.equal(judgeFilm(film(['soun'])).ok, false);
  });

  it('EVM-110 AC1: the POSITIVE CONTROL - every atom of a location is found: the QuickTime position (©xyz) in udta, in a meta/ilst, loci of 3GPP, and the word location in any atom', () => {
    const xyz = box('©xyz', Buffer.from('+52.2297+021.0122/', 'latin1'));
    assert.deepEqual(readMp4(film(['vide'], [xyz])).location, ['©xyz']);
    const inMeta = box('meta', [Buffer.alloc(4), box('ilst', [xyz])]);
    assert.deepEqual(readMp4(film(['vide'], [inMeta])).location, ['©xyz']);
    assert.deepEqual(readMp4(film(['vide'], [box('loci', Buffer.alloc(30))])).location, ['loci']);
    const word = readMp4(film(['vide'], [box('free', Buffer.from('some location text', 'latin1'))]));
    assert.deepEqual(word.location, ['location']);
    for (const udta of [[xyz], [box('loci', Buffer.alloc(30))], [box('free', Buffer.from('location', 'latin1'))]]) {
      const judged = judgeFilm(film(['vide'], udta));
      assert.equal(judged.ok, false);
      assert.match(judged.detail, /a location atom/);
    }
  });

  it('EVM-110 AC1: a film without a video track, a file that is not an MP4 and a broken one are not fine', () => {
    assert.match(judgeFilm(film(['text'])).detail, /no video track/);
    assert.deepEqual(judgeFilm(Buffer.from('not an mp4 at all, but long enough')), {
      judged: true,
      ok: false,
      detail: 'not an MP4 (no ftyp at offset 4)',
    });
    assert.equal(readMp4(Buffer.alloc(3)).valid, false);
    // a box that claims more than the file has ends the list quietly
    const cut = film(['vide']).subarray(0, 60);
    assert.equal(readMp4(cut).hasMoov, false);
  });

  it('EVM-110 AC8: the synthetic film of the hook (ftyp + one mdat, no moov) has no track to judge - it is "not judged", never "fine by silence"', () => {
    const synthetic = Buffer.concat([ftyp(), box('mdat', Buffer.alloc(5000))]);
    const judged = judgeFilm(synthetic);
    assert.equal(judged.judged, false);
    assert.match(judged.detail, /no moov/);
    assert.deepEqual(readMp4(synthetic).topLevel, ['ftyp', 'mdat']);
  });

  it('EVM-110 AC1: the sizes of a box: 64-bit size, size 0 (to the end of the file), a size below its own header, and a nested box that does not fit', () => {
    const wide = Buffer.concat([
      Buffer.from([0, 0, 0, 1]),
      Buffer.from('free', 'latin1'),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 20]),
      Buffer.alloc(4),
    ]);
    assert.deepEqual(
      boxesOf(Buffer.concat([ftyp(), wide]), 0, ftyp().length + 20).map((b) => [b.type, b.size, b.headerSize]),
      [
        ['ftyp', ftyp().length, 8],
        ['free', 20, 16],
      ],
    );
    const toEnd = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('mdat', 'latin1'), Buffer.alloc(100)]);
    assert.deepEqual(
      boxesOf(toEnd, 0, toEnd.length).map((b) => b.size),
      [108],
    );
    assert.deepEqual(boxesOf(Buffer.from([0, 0, 0, 4, 0x66, 0x72, 0x65, 0x65]), 0, 8), []);
    const huge = Buffer.concat([
      Buffer.from([0, 0, 0, 1]),
      Buffer.from('free', 'latin1'),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ]);
    assert.deepEqual(boxesOf(huge, 0, 16), []);
    const short = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('free', 'latin1'), Buffer.alloc(4)]);
    assert.deepEqual(boxesOf(short, 0, 12), []);
  });
});
