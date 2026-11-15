// @ts-check
/**
 * Scenarios of the camera (EVM-108 AC1–AC3, AC5–AC7; flows 80–89 of apps/mobile/e2e). Like the upload scenarios they are outside the
 * default run (`node tools/mobile-e2e/cli.mjs --only camera-`; docs/qa/EVM-108/plan-i-polecenia.md) and every step has `upload: true`: the
 * sign-in of the run is served by the upload part of the scenario server (src/upload-stub.mjs), whose tokens the upload operations check.
 *
 * Two kinds of picture:
 * - the REAL camera of the emulator (the virtual scene of the AVD: `hw.camera.back=virtualscene`) in the flows 81–85;
 * - the synthetic JPEG of the hook of the e2e variant in the flows 86–89 (30 shots): written to `cacheDir/Camera/<uuid>.jpg` and taken by the
 *   SAME capture pipeline as a photograph (`importOriginal`, digest, one transaction) — a real camera cannot make 30 shots in a Maestro flow
 *   in a reasonable time, and the claim of AC7 is about the way of saving and sending, not about the lens.
 *
 * The permission to use the camera: the sign-in flow starts the app WITHOUT it (`permissions: camera: unset`; Maestro grants everything
 * by default), the flows that need the camera get it from the step `camera-grant` ahead of them, the flow of the consent screen does not.
 * "Refusal for good and the return from the settings" is not automated (the system dialogs differ between releases): `manual`, EVM-112.
 */

/** The answer to every part is held this long (ms) in the 30-shot scenario: thirty small files take minutes, so the app is killed on its way. */
const BATCH_DELAY = 3000;

/**
 * The first step of every scenario: a fresh install signs in, the server forgets the earlier scenario, the log is empty, the answer to a part
 * is held `delay` ms.
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

/**
 * What the originals and the gallery must show after real shots: no location, nothing in the gallery, no permission but the camera.
 * @param {number} shots
 * @returns {import('./device.mjs').DeviceAction[]}
 */
const privatePhotos = (shots) => [`original-exif-clean:${String(shots)}`, 'gallery-unchanged', 'permissions-minimal'];

/** @type {import('./scenarios.mjs').Scenario[]} */
export const CAMERA_SCENARIOS = [
  // AC3: without the permission the consent screen "Aparat do zdjęć z prac" (no gallery, no location) with "Zezwól na dostęp do aparatu" and
  // "Nie teraz"; the refusal of the system dialog leaves the same screen; "Nie teraz" goes back to the order and the Queue is as it was; the
  // app asked for no other permission (no microphone, no location, no storage).
  {
    name: 'camera-permission',
    ac: 'EVM-108 AC3',
    steps: [
      signIn(0),
      {
        flow: '81-camera-permission.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['camera-revoke'],
        after: ['permissions-minimal'],
      },
    ],
  },
  // AC1 AC2: two shots with the real camera of one category chosen once; the file is in the private folder, the gallery is as it was, the
  // photograph carries no GPS although the emulator had a location, the app holds no location permission; both files reach the server in the
  // right work order with the SHA-256 of the original.
  {
    name: 'camera-capture',
    ac: 'EVM-108 AC1 AC2',
    steps: [
      signIn(0, ['gallery-baseline']),
      {
        flow: '82-camera-capture.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['camera-grant', 'camera-geo-fix'],
        after: [...privatePhotos(2), 'upload-checkpoint-many:2', ...CLEAN_LOG],
      },
    ],
  },
  // AC2 AC5 AC6: three shots without a network (the capsule "Offline · n", no offline banner on the camera), "Gotowe" back to the order, the
  // request for notifications once (the flow starts the app with the permission to notify denied; "Nie teraz": the work goes on), the Queue with three waiting files; same proofs of the files as above, and the
  // server has not seen a byte.
  {
    name: 'camera-series-offline',
    ac: 'EVM-108 AC2 AC5 AC6',
    steps: [
      signIn(0, ['gallery-baseline']),
      {
        flow: '83-camera-series-offline.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        before: ['camera-grant', 'camera-geo-fix'],
        after: [...privatePhotos(3), 'upload-none-yet'],
      },
    ],
  },
  // AC5: the entry through the sheet "Dodaj" -> "Zdjęcie lub film" -> the choice of the order (recent + search by number) -> the camera of that order.
  {
    name: 'camera-add-sheet',
    ac: 'EVM-108 AC5',
    steps: [signIn(0), { flow: '84-camera-add-sheet.yaml', server: 'ok', airplane: false, upload: true, before: ['camera-grant'] }],
  },
  // AC5 AC6: the mode of hidden data (the screen lock is off): the choice of the order shows numbers only, the bar of the camera has no number,
  // the camera works, the row of the file in the Queue has no number; the file goes on its way.
  {
    name: 'camera-hidden-data',
    ac: 'EVM-108 AC5 AC6',
    steps: [
      signIn(0),
      {
        flow: '85-camera-hidden.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['camera-grant'],
        after: ['upload-checkpoint-many:1', ...CLEAN_LOG],
      },
    ],
  },
  // AC7: 30 pictures saved without a network by the same path as the camera; the app is killed right after the last confirmation (kill -9);
  // restarted offline: 30 files waiting, the server has not seen a byte; the network returns and the transfer starts; the app is stopped by
  // force in the middle of it, started again, killed (kill -9) in the middle of it again, started again. At the end the checkpoint of the
  // server: 30 objects in the right work order, one per asset, equal SHA-256, 0 duplicates, and 30 files "Wysłano" in the Queue.
  {
    name: 'camera-batch-30',
    ac: 'EVM-108 AC7',
    steps: [
      signIn(BATCH_DELAY),
      { flow: '86-camera-batch-inject.yaml', server: 'ok', airplane: true, upload: true, after: ['kill-9'] },
      { flow: '87-camera-batch-after-kill.yaml', server: 'ok', airplane: true, upload: true, after: ['jobs-none', 'upload-none-yet'] },
      { flow: '88-camera-batch-uploading.yaml', server: 'ok', airplane: false, background: true, upload: true, after: ['force-stop'] },
      { flow: '88-camera-batch-uploading.yaml', server: 'ok', airplane: false, upload: true, after: ['kill-9'] },
      {
        flow: '89-camera-batch-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['upload-checkpoint-many:30', ...CLEAN_LOG],
      },
    ],
  },
];
