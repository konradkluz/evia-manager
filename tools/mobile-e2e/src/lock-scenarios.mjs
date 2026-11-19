// @ts-check
/**
 * Scenario of the lock of the app (EVM-146 AC1; flows 130-139 of apps/mobile/e2e). Like the camera and order-files scenarios it is outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only lock-`); the sign-in of the run is served by the upload part of the scenario server (`upload: true`).
 *
 * `lock-view-tree`: the sign-in, then the form of a new entry of the order ZL-E2E-1 with a typed word, the return from the background after 6 minutes (the
 * clock of the hook) with the system unlock held - the app is locked; the step `view-tree-locked` reads the tree of views three times with the UNCOMPRESSED
 * `uiautomator dump` (views not important for accessibility included) and fails when any synthetic value of the order, the customer or the form is in
 * `text`, `content-desc`, `hint` or `resource-id`, or when the cover is not in the tree (src/device-lock.mjs).
 */

/** @type {import('./scenarios.mjs').Scenario[]} */
export const LOCK_SCENARIOS = [
  {
    name: 'lock-view-tree',
    ac: 'EVM-146 AC1',
    steps: [
      { flow: '80-camera-sign-in.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-reset'] },
      { flow: '130-lock-view-tree.yaml', server: 'ok', airplane: false, upload: true, after: ['view-tree-locked'] },
    ],
  },
];
