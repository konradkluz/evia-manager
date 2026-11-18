// @ts-check
/**
 * Scenario of "Pliki zlecenia" (EVM-111; flows 120-129 of apps/mobile/e2e). Like the camera and upload scenarios it is outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only order-files`) and every step has `upload: true`: the sign-in of the run is served by the upload part of the scenario
 * server (src/upload-stub.mjs). The sign-in flow is the one of the camera scenarios (`80-camera-sign-in.yaml`); the files are synthetic JPEGs of the hook of
 * the e2e variant (`media: capture N`) in the order ZL-E2E-1 of the scenario server - no camera is used.
 *
 * What it proves, in three steps after the sign-in:
 * 1. offline - two files of the order: the row "Pliki z tego telefonu" says "2 do wysłania", the screen "Pliki zlecenia" lists both as "Oczekuje" (no error, no
 *    banner of the connection); the server has not seen a byte;
 * 2. the network is back and the files go: the server has the two objects, yet the phone still counts "2 do wysłania" (the end of the transfer is no
 *    confirmation) and the originals are still on it;
 * 3. the server confirms the files (`clean`; the app reads it when it comes back to the foreground, so the step is `background`): the row and the header say
 *    "Wszystko wysłane", the entries are gone from the screen, the Queue and the counters of the hook, and the originals are gone.
 */

/** The checks at the end of a scenario that sent a file: nothing of a token or a signed address in the log or the files of the app. @type {import('./device.mjs').DeviceAction[]} */
const CLEAN_LOG = ['tokens-not-in-clear', 'logcat-clean'];

/** @type {import('./scenarios.mjs').Scenario[]} */
export const ORDER_FILES_SCENARIOS = [
  {
    name: 'order-files-status',
    ac: 'EVM-111 AC1 AC2 AC3 AC5 AC6',
    steps: [
      {
        flow: '80-camera-sign-in.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['upload-reset', 'logcat-clear', 'upload-part-delay:0'],
      },
      { flow: '120-order-files-offline.yaml', server: 'ok', airplane: true, upload: true, after: ['jobs-none', 'upload-none-yet'] },
      {
        flow: '120-order-files-sending.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['upload-checkpoint-many:2', 'original-present'],
      },
      {
        flow: '120-order-files-confirmed.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        before: ['upload-file-state:clean'],
        after: ['original-absent', ...CLEAN_LOG],
      },
    ],
  },
];
