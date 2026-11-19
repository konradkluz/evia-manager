// @ts-check
/**
 * Scenario of the lock of the app (EVM-146 AC1; flows 130-135 of apps/mobile/e2e). Like the camera and order-files scenarios it is outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only lock-`); the sign-in of the run is served by the upload part of the scenario server (`upload: true`).
 *
 * Scenarios: `lock-view-tree` (AC1, AC4: positive control, resume samples, cancelled unlock; src/device-lock.mjs), `lock-state-kept` and `lock-survey-kept` (AC2), `lock-camera-kept`
 * (AC3, AC5), `lock-camera-released` (AC3: the camera service has no client of the app under the cover). The decision to lock before the first render of the content is read as several samples of the tree while the app returns.
 */

/** @type {import('./scenarios.mjs').Scenario[]} */
export const LOCK_SCENARIOS = [
  // AC1 AC4: the form with a typed word is open and UNLOCKED - the positive control finds the control values in the tree; then the return from the background after
  // 6 minutes with the unlock held (the tree is read five times while the cover goes on - the last read must show it); the unlock is cancelled once more and
  // the tree is read again (three reads): none of them may hold a value.
  {
    name: 'lock-view-tree',
    ac: 'EVM-146 AC1 AC4',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      { flow: '130-lock-form-typed.yaml', server: 'ok', airplane: false, upload: true, after: ['view-tree-unlocked'] },
      { flow: '133-lock-hold-and-leave.yaml', server: 'ok', airplane: false, upload: true, after: ['view-tree-resume'] },
      { flow: '134-lock-cancelled-unlock.yaml', server: 'ok', airplane: false, upload: true, after: ['view-tree-locked'] },
    ],
  },
  // AC2: the same path with the automatic unlock - the form and the typed word are still there.
  {
    name: 'lock-state-kept',
    ac: 'EVM-146 AC2',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      { flow: '131-lock-state-kept.yaml', server: 'ok', airplane: false, upload: true },
    ],
  },
  // AC2: the largest form (the site survey) keeps its typed fields.
  {
    name: 'lock-survey-kept',
    ac: 'EVM-146 AC2',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      { flow: '132-lock-survey-kept.yaml', server: 'ok', airplane: false, upload: true },
    ],
  },
  // AC3 AC5: the camera that was open before the lock shows a live preview after the unlock (a shot is saved).
  {
    name: 'lock-camera-kept',
    ac: 'EVM-146 AC3 AC5',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      { flow: '135-lock-camera-kept.yaml', server: 'ok', airplane: false, upload: true, before: ['camera-grant'] },
    ],
  },
  // AC3 (S2): the camera is open and the app is a client of the camera service; after the lock (the unlock held) the camera is released - the service has no client of the app.
  {
    name: 'lock-camera-released',
    ac: 'EVM-146 AC3',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      {
        flow: '137-lock-camera-open.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['camera-grant'],
        after: ['camera-client-present'],
      },
      { flow: '136-lock-camera-hold.yaml', server: 'ok', airplane: false, upload: true, after: ['camera-client-absent'] },
    ],
  },
];
