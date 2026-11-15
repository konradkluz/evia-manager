// @ts-check
/**
 * A reader of the boxes ("atoms") of an MP4 for the check of a recorded film (EVM-110 AC1; SEC-110-04): the film has NO sound track and NO location.
 * It reads the top level, then goes down `moov` through the containers that can hold a track or a place (`trak`, `mdia`, `udta`, `meta`, `ilst`) and collects
 *  - the handler type of every track (`hdlr` of `mdia`: `vide` = video, `soun` = sound, others - text, metadata),
 *  - the atoms that carry a place: `©xyz` (QuickTime / iTunes position), `loci` (3GPP location), and the word `location` anywhere in `moov`.
 * The reader is proved on films built in `node:test` WITH a sound track and a location (the positive control): a reader that finds nothing anywhere would
 * pass every file. A file without a `moov` (the synthetic film of the hook is only `ftyp` + `mdat`) has no tracks to judge: it is `judged: false`.
 */

/** @typedef {{ type: string, offset: number, size: number, headerSize: number }} Box */
/** @typedef {{ valid: boolean, brand: string | null, topLevel: string[], hasMoov: boolean, handlers: string[], location: string[] }} Mp4Facts */

/** The containers whose children are read (`meta` is a "full box": 4 bytes of version and flags come first). */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'udta', 'ilst']);
const FULL_CONTAINERS = new Set(['meta']);
const LOCATION_ATOMS = ['©xyz', 'loci'];

/**
 * The boxes of [buffer] between [start] and [end] (a box that does not fit ends the list; nothing throws).
 * @param {Buffer} buffer @param {number} start @param {number} end
 * @returns {Box[]}
 */
export function boxesOf(buffer, start, end) {
  /** @type {Box[]} */
  const boxes = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    let headerSize = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const wide = buffer.readBigUInt64BE(at + 8);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(wide);
      headerSize = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerSize || at + size > end) break;
    boxes.push({ type, offset: at, size, headerSize });
    at += size;
  }
  return boxes;
}

/**
 * Walks the boxes below [start, end) and fills [facts].
 * @param {Buffer} buffer @param {number} start @param {number} end @param {Mp4Facts} facts @param {boolean} insideTrack
 */
function walk(buffer, start, end, facts, insideTrack) {
  for (const box of boxesOf(buffer, start, end)) {
    const from = box.offset + box.headerSize;
    const to = box.offset + box.size;
    if (LOCATION_ATOMS.includes(box.type)) facts.location.push(box.type);
    if (box.type === 'hdlr' && insideTrack && to - from >= 12) facts.handlers.push(buffer.toString('latin1', from + 8, from + 12));
    if (CONTAINERS.has(box.type)) walk(buffer, from, to, facts, insideTrack || box.type === 'trak');
    else if (FULL_CONTAINERS.has(box.type) && to - from >= 4) walk(buffer, from + 4, to, facts, insideTrack);
  }
}

/**
 * What the file is made of.
 * @param {Buffer} buffer
 * @returns {Mp4Facts}
 */
export function readMp4(buffer) {
  /** @type {Mp4Facts} */
  const facts = { valid: false, brand: null, topLevel: [], hasMoov: false, handlers: [], location: [] };
  if (buffer.length < 16 || buffer.toString('latin1', 4, 8) !== 'ftyp') return facts;
  const top = boxesOf(buffer, 0, buffer.length);
  facts.valid = top.length > 0 && top[0]?.type === 'ftyp';
  facts.brand = buffer.toString('latin1', 8, 12);
  facts.topLevel = top.map((box) => box.type);
  for (const box of top) {
    if (box.type !== 'moov') continue;
    facts.hasMoov = true;
    walk(buffer, box.offset + box.headerSize, box.offset + box.size, facts, false);
    // a place may sit in an atom of a kind this reader does not descend into: the word itself, anywhere in `moov`
    const text = buffer.toString('latin1', box.offset, box.offset + box.size);
    if (text.includes('location') && !facts.location.includes('location')) facts.location.push('location');
    for (const atom of LOCATION_ATOMS) if (text.includes(atom) && !facts.location.includes(atom)) facts.location.push(atom);
  }
  return facts;
}

/**
 * One film: valid MP4, a track of video and no track of sound, no location atom. No `moov` = nothing to judge (`judged: false`).
 * @param {Buffer} buffer
 * @returns {{ judged: boolean, ok: boolean, detail: string }}
 */
export function judgeFilm(buffer) {
  const facts = readMp4(buffer);
  if (!facts.valid) return { judged: true, ok: false, detail: 'not an MP4 (no ftyp at offset 4)' };
  if (!facts.hasMoov) return { judged: false, ok: true, detail: 'no moov (a synthetic film of the hook): no track to judge' };
  const problems = [];
  if (!facts.handlers.includes('vide')) problems.push('no video track');
  if (facts.handlers.includes('soun')) problems.push('a SOUND track (soun)');
  if (facts.location.length > 0) problems.push(`a location atom (${facts.location.join(', ')})`);
  return problems.length === 0
    ? { judged: true, ok: true, detail: `tracks: ${facts.handlers.join(', ')}; no sound track, no location atom` }
    : { judged: true, ok: false, detail: problems.join('; ') };
}
