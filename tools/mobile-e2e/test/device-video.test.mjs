import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultNetworkOf,
  filmsListed,
  isVideoAction,
  judgeFilms,
  judgeVideoGallery,
  runVideoAction,
  switchNetwork,
  videoCommands,
} from '../src/device-video.mjs';
import { runDeviceAction } from '../src/device.mjs';

const APP = 'pl.eviacharge.manager';
const ID = (/** @type {number} */ n) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** @param {number | null} status @param {string} [stdout] @param {string} [stderr] */
const out = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });

/** `dumpsys connectivity` in the shape the reader needs: the default network and its capabilities. @param {number} id @param {string} transports @param {string} capabilities */
const connectivity = (id, transports, capabilities) =>
  `Active default network: ${String(id)}\nCurrent network info:\n  NetworkAgentInfo{network{${String(id)}}  handle{1} ni{[type: X]} nc{[ Transports: ${transports} Capabilities: ${capabilities} LinkUpBandwidthKbps: 1]} }\n  NetworkAgentInfo{network{99}  nc{[ Transports: WIFI Capabilities: NOT_METERED&INTERNET&VALIDATED ]} }\n`;
const MOBILE = connectivity(100, 'CELLULAR', 'NOT_VCN_MANAGED&INTERNET&NOT_RESTRICTED&TRUSTED&VALIDATED');
const WIFI = connectivity(101, 'WIFI', 'NOT_METERED&INTERNET&NOT_RESTRICTED&TRUSTED&VALIDATED');

/** @param {Record<string, ReturnType<typeof out> | ReturnType<typeof out>[]>} [answers] */
function fake(answers = {}) {
  /** @type {string[]} */
  const calls = [];
  const memory = new Map();
  const context = {
    adb: (/** @type {string[]} */ ...args) => {
      const line = args.join(' ');
      calls.push(line);
      for (const [needle, answer] of Object.entries(answers)) {
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
    memory,
    uploadControl: undefined,
  };
  return { context: /** @type {import('../src/device-upload.mjs').UploadContext} */ (context), calls, memory };
}

describe('the commands of the video steps (EVM-110)', () => {
  it('EVM-110 AC4: the network is switched with svc - Wi-Fi off with data on is the mobile network, Wi-Fi on is the other; nothing is written in a shell string but fixed words', () => {
    assert.deepEqual(videoCommands.wifi(false), ['shell', 'svc', 'wifi', 'disable']);
    assert.deepEqual(videoCommands.wifi(true), ['shell', 'svc', 'wifi', 'enable']);
    assert.deepEqual(videoCommands.data(), ['shell', 'svc', 'data', 'enable']);
    assert.deepEqual(videoCommands.connectivity(), ['shell', 'dumpsys', 'connectivity']);
  });

  it('EVM-110 AC1: a film is read by its name only - `<uuid>.mp4`; anything else (a path, a plain asset id, a wrong suffix) is refused before it reaches a shell', () => {
    assert.deepEqual(videoCommands.readFilm(`${ID(1)}.mp4`), [
      'shell',
      `run-as ${APP} base64 no_backup/evia-upload/originals/${ID(1)}.mp4`,
    ]);
    for (const bad of [ID(1), `${ID(1)}.jpg`, '../../token.mp4', `${ID(1)}.mp4; id`, '.mp4'])
      assert.throws(() => videoCommands.readFilm(bad), /not a film name/);
    assert.deepEqual(videoCommands.listOriginals(), ['shell', `run-as ${APP} ls -l no_backup/evia-upload/originals`]);
  });

  it('EVM-110 AC8: the names of the video steps are recognised, the others are not', () => {
    for (const name of [
      'network-metered',
      'network-unmetered',
      'video-gallery-baseline',
      'video-gallery-unchanged',
      'video-no-audio-no-location:1',
      'upload-part-puts:3',
      'upload-part-puts-hold',
    ])
      assert.equal(isVideoAction(name), true, name);
    for (const name of ['kill-9', 'camera-grant', 'upload-checkpoint-many:3']) assert.equal(isVideoAction(name), false, name);
  });
});

describe('the default network from `dumpsys connectivity` (EVM-110 AC4, AC5)', () => {
  it('EVM-110 AC4: mobile without NOT_METERED is a network with charges, Wi-Fi with NOT_METERED is one without; only the DEFAULT network counts (another one in the text is ignored)', () => {
    assert.deepEqual(defaultNetworkOf(MOBILE), { transport: 'cellular', metered: true, validated: true });
    assert.deepEqual(defaultNetworkOf(WIFI), { transport: 'wifi', metered: false, validated: true });
    assert.deepEqual(defaultNetworkOf(connectivity(100, 'CELLULAR', 'INTERNET')), {
      transport: 'cellular',
      metered: true,
      validated: false,
    });
    assert.deepEqual(defaultNetworkOf(connectivity(7, 'BLUETOOTH', 'NOT_METERED&VALIDATED')), {
      transport: 'other',
      metered: false,
      validated: true,
    });
  });

  it('EVM-110 AC4: a text that is not what the reader expects is `null` - never a guess', () => {
    assert.equal(defaultNetworkOf(''), null);
    assert.equal(defaultNetworkOf('Active default network: none'), null);
    assert.equal(defaultNetworkOf('Active default network: 5\nno agent lines here'), null);
  });
});

describe('the switch of the network (EVM-110 AC4, AC5, AC8)', () => {
  it('EVM-110 AC4: "metered" takes Wi-Fi away, keeps the data on and waits until the default network is the validated mobile one - polling, not sleeping', async () => {
    const { context, calls } = fake({ 'dumpsys connectivity': [out(0, WIFI), out(0, WIFI), out(0, MOBILE)] });
    const done = await switchNetwork(context, true);
    assert.equal(done.ok, true);
    assert.match(done.detail, /mobile: validated, with charges/);
    assert.deepEqual(calls.slice(0, 2), ['shell svc wifi disable', 'shell svc data enable']);
    assert.equal(calls.filter((call) => call.includes('dumpsys connectivity')).length, 3);
  });

  it('EVM-110 AC4: "unmetered" puts Wi-Fi back and waits for the validated Wi-Fi without charges', async () => {
    const { context, calls } = fake({ 'dumpsys connectivity': [out(0, MOBILE), out(0, WIFI)] });
    assert.equal((await switchNetwork(context, false)).ok, true);
    assert.equal(calls[0], 'shell svc wifi enable');
  });

  it('EVM-110 AC4: a network that never becomes the wanted one fails with what it was (kind and charges, never an address); a failing svc fails at once', async () => {
    const stuck = await switchNetwork(fake({ 'dumpsys connectivity': out(0, WIFI) }).context, true);
    assert.equal(stuck.ok, false);
    assert.match(stuck.detail, /did not become mobile with charges in 90 s \(wifi, without charges, validated\)/);
    const unreadable = await switchNetwork(fake({ 'dumpsys connectivity': out(0, 'nothing') }).context, false);
    assert.match(unreadable.detail, /unreadable/);
    const refused = await switchNetwork(fake({ 'svc wifi': out(1) }).context, true);
    assert.deepEqual(refused, { ok: false, detail: 'svc could not switch the network' });
  });

  it('EVM-110 AC4: the steps are dispatched by the runner of device steps', async () => {
    const { context } = fake({ 'dumpsys connectivity': out(0, MOBILE) });
    const result = await runDeviceAction('network-metered', /** @type {never} */ (context));
    assert.equal(result.ok, true);
  });
});

describe('the films of the app judged for sound and place (EVM-110 AC1; SEC-110-04)', () => {
  const LS = [
    'total 99',
    `-rw------- 1 u0_a123 u0_a123 3123456 2026-11-15 20:10 ${ID(1)}.mp4`,
    `-rw------- 1 u0_a123 u0_a123 67108864 2026-11-15 20:11 ${ID(2)}.mp4`,
    `-rw------- 1 u0_a123 u0_a123 300000 2026-11-15 20:12 ${ID(3)}`,
    `-rw------- 1 u0_a123 u0_a123 9 2026-11-15 20:12 ${ID(4)}.mp4.tmp`,
  ].join('\n');

  it('EVM-110 AC1: the listing gives the films (`<uuid>.mp4`) with their sizes - pictures, temporary files and the header line are not films', () => {
    assert.deepEqual(filmsListed(LS), [
      { name: `${ID(1)}.mp4`, size: 3_123_456 },
      { name: `${ID(2)}.mp4`, size: 67_108_864 },
    ]);
    assert.deepEqual(filmsListed(''), []);
  });

  /** @param {string[]} handlers @param {Buffer[]} [udta] */
  const film = (handlers, udta = []) => {
    const box = (/** @type {string} */ type, /** @type {Buffer[]} */ parts = []) => {
      const body = Buffer.concat(parts);
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length + 8, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const hdlr = (/** @type {string} */ handler) => box('hdlr', [Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(13)]);
    const trak = (/** @type {string} */ handler) => box('trak', [box('mdia', [hdlr(handler)])]);
    return Buffer.concat([
      box('ftyp', [Buffer.from('isom', 'latin1'), Buffer.alloc(8)]),
      box('mdat', [Buffer.alloc(200)]),
      box('moov', [...handlers.map(trak), ...(udta.length === 0 ? [] : [box('udta', udta)])]),
    ]);
  };

  it('EVM-110 AC1: a clean film passes, a film with sound or a place fails with the reason, and too few judged films fail (the proof would be empty)', () => {
    assert.deepEqual(judgeFilms({ a: film(['vide']) }, 1).ok, true);
    assert.match(judgeFilms({ a: film(['vide', 'soun']) }, 1).detail, /SOUND track/);
    assert.match(
      judgeFilms({ a: film(['vide'], [Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('loci', 'latin1'), Buffer.alloc(4)])]) }, 1)
        .detail,
      /location atom/,
    );
    assert.match(judgeFilms({}, 1).detail, /0 film\(s\) with tracks to judge, 1 expected/);
    // a synthetic film has no moov: not judged, so it does not count as a proof
    const synthetic = Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from('ftyp', 'latin1'),
      Buffer.from('isom', 'latin1'),
      Buffer.alloc(4),
    ]);
    assert.match(judgeFilms({ s: synthetic }, 1).detail, /0 film\(s\) with tracks to judge/);
  });

  it('EVM-110 AC1: the step reads the small films only (the 64 MiB one is left alone), judges them, and says "not performed" without a back camera', async () => {
    const clean = film(['vide']).toString('base64');
    const { context, calls } = fake({
      'pm list features': out(0, 'feature:android.hardware.camera\nfeature:android.hardware.camera.any\n'),
      'ls -l': out(0, LS),
      base64: out(0, clean),
    });
    const done = await runVideoAction('video-no-audio-no-location:1', context);
    assert.equal(done.ok, true);
    assert.match(done.detail, /1 film\(s\): a video track, no sound track/);
    assert.equal(calls.filter((call) => call.includes('base64')).length, 1);
    assert.ok(calls.some((call) => call.includes(`${ID(1)}.mp4`)));
    assert.ok(!calls.some((call) => call.includes(`${ID(2)}.mp4`)));
    const noCamera = await runVideoAction(
      'video-no-audio-no-location:1',
      fake({ 'pm list features': out(0, 'feature:android.hardware.wifi\n') }).context,
    );
    assert.equal(noCamera.ok, true);
    assert.equal(noCamera.skipped, true);
    assert.match(noCamera.detail, /NOT PERFORMED/);
  });

  it('EVM-110 AC1: the step fails when the folder cannot be listed, a film cannot be read, or the number is missing', async () => {
    const camera = out(0, 'feature:android.hardware.camera\n');
    assert.equal(
      (await runVideoAction('video-no-audio-no-location:1', fake({ 'pm list features': camera, 'ls -l': out(1) }).context)).ok,
      false,
    );
    assert.equal(
      (
        await runVideoAction(
          'video-no-audio-no-location:1',
          fake({ 'pm list features': camera, 'ls -l': out(0, LS), base64: out(1) }).context,
        )
      ).ok,
      false,
    );
    assert.match((await runVideoAction('video-no-audio-no-location', fake().context)).detail, /needs the number of films/);
    assert.match((await runVideoAction('video-no-audio-no-location:0', fake().context)).detail, /needs the number of films/);
  });
});

describe('the video gallery (EVM-110 AC1; SEC-110-08)', () => {
  const ROWS = 'Row: 0 _id=1\nRow: 1 _id=2\n';
  const answers = (/** @type {string} */ rows, /** @type {string} */ files) => ({
    'content query': out(0, rows),
    'find /sdcard/DCIM': out(0, files),
    'ls -d /sdcard/DCIM': out(0, '/sdcard/DCIM\n'),
  });

  it('EVM-110 AC1: the baseline and the later reading are the same - unchanged; one more row or one more file in the public folders is CHANGED (a film reached the gallery)', async () => {
    const same = fake(answers(ROWS, '/sdcard/DCIM/a.mp4\n'));
    assert.equal((await runVideoAction('video-gallery-baseline', same.context)).ok, true);
    const ok = await runVideoAction('video-gallery-unchanged', same.context);
    assert.equal(ok.ok, true);
    assert.match(ok.detail, /MediaStore video rows 2 -> 2; files in .* 1 -> 1: unchanged/);
    const rowAdded = fake(answers(ROWS, '/sdcard/DCIM/a.mp4\n'));
    await runVideoAction('video-gallery-baseline', rowAdded.context);
    const changedContext = fake(answers(`${ROWS}Row: 2 _id=3\n`, '/sdcard/DCIM/a.mp4\n'));
    changedContext.memory.set('video-gallery', rowAdded.memory.get('video-gallery'));
    assert.match((await runVideoAction('video-gallery-unchanged', changedContext.context)).detail, /CHANGED/);
    const fileAdded = fake(answers(ROWS, '/sdcard/DCIM/a.mp4\n/sdcard/Movies/b.mp4\n'));
    fileAdded.memory.set('video-gallery', same.memory.get('video-gallery'));
    assert.equal((await runVideoAction('video-gallery-unchanged', fileAdded.context)).ok, false);
  });

  it('EVM-110 AC1: without a baseline, or when the gallery cannot be read, the step FAILS - an empty proof is not a pass', async () => {
    assert.match((await runVideoAction('video-gallery-unchanged', fake().context)).detail, /no baseline/);
    assert.match((await runVideoAction('video-gallery-baseline', fake({ 'content query': out(1) }).context)).detail, /could not be read/);
    const unread = fake(answers(ROWS, ''));
    unread.memory.set('video-gallery', { images: 2, files: [] });
    unread.context.adb = () => out(1);
    assert.match((await runVideoAction('video-gallery-unchanged', unread.context)).detail, /could not be read/);
  });

  it('EVM-110 AC1: the judgement of two states says counts only', () => {
    assert.deepEqual(judgeVideoGallery({ images: 1, files: ['a'] }, { images: 1, files: ['a'] }).ok, true);
    assert.equal(judgeVideoGallery({ images: 1, files: ['a'] }, { images: 1, files: ['b'] }).ok, false);
  });
});

describe('the parts the server received (EVM-110 AC4, AC5)', () => {
  /** @param {number[]} counts the number of parts at each reading */
  const server = (counts) => {
    let at = 0;
    return /** @type {never} */ ({
      adb: () => out(0),
      sleep: () => Promise.resolve(),
      uploadControl: () => {
        const partPuts = counts[Math.min(at, counts.length - 1)] ?? 0;
        at += 1;
        return Promise.resolve({ status: 200, body: { assets: {}, orphanedMultiparts: 0, openMultiparts: 0, counters: { partPuts } } });
      },
    });
  };

  it('EVM-110 AC4: exactly the expected number of parts, and no late one, passes; fewer, or one that comes late, fails', async () => {
    assert.equal((await runVideoAction('upload-part-puts:1', server([1, 1]))).ok, true);
    const late = await runVideoAction('upload-part-puts:1', server([1, 2]));
    assert.equal(late.ok, false);
    assert.match(late.detail, /received 2 part\(s\) in all \(expected exactly 1/);
    assert.match((await runVideoAction('upload-part-puts:2', server([0]))).detail, /received 0 part\(s\), at least 2 expected/);
    assert.equal((await runVideoAction('upload-part-puts:0', server([0, 0]))).ok, true);
    assert.equal((await runVideoAction('upload-part-puts:0', server([0, 3]))).ok, false);
    assert.match((await runVideoAction('upload-part-puts', server([0]))).detail, /needs the number of parts/);
  });

  it('EVM-110 AC5: during the quiet time of the network with charges the number of parts does not grow; a growing one fails, and an unreadable server fails too', async () => {
    assert.equal((await runVideoAction('upload-part-puts-hold', server([4, 4]))).ok, true);
    const grew = await runVideoAction('upload-part-puts-hold', server([4, 5]));
    assert.equal(grew.ok, false);
    assert.match(grew.detail, /parts received 4 -> 5/);
    const down = /** @type {never} */ ({ adb: () => out(0), sleep: () => Promise.resolve(), uploadControl: () => Promise.resolve(null) });
    assert.equal((await runVideoAction('upload-part-puts-hold', down)).ok, false);
  });

  it('EVM-110 AC8: an unknown video step is a failure', async () => {
    assert.deepEqual(await runVideoAction('nothing', fake().context), { action: 'nothing', ok: false, detail: 'unknown video step' });
  });
});
