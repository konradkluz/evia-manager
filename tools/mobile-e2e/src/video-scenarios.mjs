// @ts-check
/**
 * Scenarios of the film mode of the camera (EVM-110; flows 90-102 of apps/mobile/e2e). Like the camera and upload scenarios they are outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only video-`; docs/qa/EVM-110/plan-i-polecenia.md) and every step has `upload: true`: the sign-in of the run is served by the
 * upload part of the scenario server (src/upload-stub.mjs), whose tokens the upload operations check. The sign-in flow is the one of the camera scenarios
 * (`80-camera-sign-in.yaml`: a fresh install without the permission for the camera); the steps that record get the permission from `camera-grant`.
 *
 * Two kinds of film:
 * - the REAL recording of the camera of the emulator (the virtual scene) through `recordAsync` of expo-camera - a few seconds, a few MB;
 * - the SYNTHETIC MP4 of the hook of the e2e variant (`media: capture video`, 16-64 MiB): written to `cacheDir/Camera/<uuid>.mp4` and taken by the SAME capture
 *   pipeline as a recording (the native import MOVES it, the digest, one transaction) - a real camera cannot make 128 MiB in a flow in reasonable time, and
 *   the claim of AC8 is about the way of saving and sending, not about the lens.
 *
 * The network is switched for REAL (`network-metered`: Wi-Fi off and mobile data on = a network WITH charges; `network-unmetered`: Wi-Fi on), the runner puts
 * Wi-Fi back at the end of every scenario and in its `finally`.
 */

/**
 * The answer to every part is held this long (ms) in the scenarios that interrupt a transfer: a part is stored by the server at once and only its ANSWER
 * waits, so the transfer lasts (16 parts of a film of 64 MiB take about 24 s) and the interruption finds it still going.
 */
const BATCH_DELAY = 1500;
const MIDWAY_DELAY = 5000;

/**
 * The first step of every scenario: a fresh install signs in, the server forgets the earlier scenario, the log is empty, the answer to a part is held `delay` ms.
 * @param {number} delay @param {import('./device.mjs').DeviceAction[]} [after]
 * @returns {import('./scenarios.mjs').Step}
 */
const signIn = (delay, after = []) => ({
  flow: '80-camera-sign-in.yaml',
  server: 'ok',
  airplane: false,
  upload: true,
  before: ['upload-reset', 'logcat-clear', `upload-part-delay:${String(delay)}`],
  ...(after.length === 0 ? {} : { after }),
});

/** The checks at the end of a scenario that sent a file: nothing of a token or a signed address in the log or the files of the app. @type {import('./device.mjs').DeviceAction[]} */
const CLEAN_LOG = ['tokens-not-in-clear', 'logcat-clean'];

/** @type {import('./scenarios.mjs').Scenario[]} */
export const VIDEO_SCENARIOS = [
  // AC1 AC2 AC6 (the smoke flow): the film mode with the real camera of the emulator, which was given a location first (`camera-geo-fix`); a few seconds of
  // recording without a network, the save, the row of the film in the Queue. Then the file itself: a video track and no sound track, no location atom; no
  // film in the public gallery; no permission but the camera (no microphone, no location).
  {
    name: 'video-record',
    ac: 'EVM-110 AC1 AC2 AC6',
    steps: [
      signIn(0, ['video-gallery-baseline']),
      {
        flow: '90-video-record.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        before: ['camera-grant', 'camera-geo-fix'],
        onFail: ['video-last-error'],
        after: ['video-no-audio-no-location:1', 'video-gallery-unchanged', 'permissions-minimal', 'upload-none-yet', 'logcat-clean'],
      },
    ],
  },
  // AC4: on the network with charges the film waits and the picture goes (the server got exactly the one part of the picture); with the network without
  // charges the film goes on its own, and the server holds one object for each of the two.
  {
    name: 'video-wifi-only',
    ac: 'EVM-110 AC4 AC6',
    steps: [
      signIn(0),
      {
        flow: '91-video-wifi-held.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-metered'],
        after: ['upload-part-puts:1'],
      },
      {
        flow: '92-video-wifi-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-unmetered'],
        after: ['upload-checkpoint-many:2', ...CLEAN_LOG],
      },
    ],
  },
  // AC4: the setting turned off in "Więcej -> Wysyłanie" lets the waiting film go through the network with charges.
  {
    name: 'video-wifi-setting-off',
    ac: 'EVM-110 AC4',
    steps: [
      signIn(0),
      {
        flow: '93-video-setting-off.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-metered'],
        after: ['upload-checkpoint-many:1', ...CLEAN_LOG],
      },
    ],
  },
  // AC5: a film is on its way over Wi-Fi; Wi-Fi goes (the phone keeps the mobile network): the film waits for Wi-Fi without an error and not one more part comes
  // over the network with charges; Wi-Fi returns and the film is finished - one object, the SHA-256 of the original, no duplicate.
  {
    name: 'video-wifi-midway',
    ac: 'EVM-110 AC5',
    steps: [
      signIn(MIDWAY_DELAY),
      {
        flow: '94-video-midway-start.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-unmetered'],
        after: ['network-metered'],
      },
      { flow: '95-video-midway-waiting.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-part-puts-hold'] },
      {
        flow: '92-video-wifi-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-unmetered', 'upload-part-delay:0'],
        after: ['upload-checkpoint-many:1', ...CLEAN_LOG],
      },
    ],
  },
  // AC8: three films (two synthetic of 64 MiB and one real recording) saved without a network by the same path of the camera, the app killed, started again
  // offline (the three wait for the connection), the network WITH charges (they wait for Wi-Fi: the server gets no part), Wi-Fi back (the transfer starts,
  // the server drops the connection in the middle of a part once), the app stopped by force in the middle of the transfer, started again (the transfer is
  // finished). The checkpoint of the server: three objects in the right work order, one per asset, the SHA-256 of the originals, 0 duplicates, 0 orphaned
  // multiparts; the three rows are "Wysłano"; nothing in the public gallery.
  {
    name: 'video-batch-3',
    ac: 'EVM-110 AC8',
    steps: [
      signIn(BATCH_DELAY, ['video-gallery-baseline']),
      { flow: '96-video-batch-inject.yaml', server: 'ok', airplane: true, upload: true, before: ['camera-grant'], after: ['kill-9'] },
      { flow: '97-video-batch-after-kill.yaml', server: 'ok', airplane: true, upload: true, after: ['jobs-none', 'upload-none-yet'] },
      {
        flow: '98-video-batch-held.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['network-metered'],
        after: ['upload-part-puts:0'],
      },
      {
        flow: '99-video-batch-uploading.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        before: ['network-unmetered', 'upload-fault:drop_mid_part:1'],
        after: ['force-stop'],
      },
      {
        flow: '92-video-wifi-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['upload-part-delay:0'],
        after: ['upload-checkpoint-many:3', 'video-gallery-unchanged', ...CLEAN_LOG],
      },
    ],
  },
  // AC3: the app loses the foreground (Home) during a recording: the film is saved like a normal one; the app is killed during a recording: nothing is saved,
  // no row of a damaged film, and once the Banner "Poprzednie nagranie zostało przerwane i nie zostało zapisane."
  {
    name: 'video-interrupt',
    ac: 'EVM-110 AC3',
    steps: [
      signIn(0),
      {
        flow: '100-video-interrupt-home.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        before: ['camera-grant'],
        after: ['upload-none-yet', 'logcat-clean'],
      },
      {
        flow: '101-video-kill-recording.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        before: ['camera-grant'],
        after: ['kill-9'],
      },
      { flow: '102-video-kill-after.yaml', server: 'ok', airplane: true, upload: true, after: ['upload-none-yet', 'logcat-clean'] },
    ],
  },
];
