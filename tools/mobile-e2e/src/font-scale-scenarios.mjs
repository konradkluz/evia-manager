// @ts-check
/**
 * Scenario of the app bar and the bottom navigation at a large system font (EVM-151 AC1-AC5; flows 150-154 of apps/mobile/e2e). Outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only font-scale`); the sign-in of the run is served by the upload part of the scenario server, the replica carries the photos of the
 * order ZL-E2E-1 (so that M-08 "Zdjęcia zlecenia" can be opened).
 *
 * The phone signs in at the default scale and is magnified afterwards (the device step `display:`, src/device-display.mjs): the same tour of the screens (common/font-scale-tour.yaml, one
 * screenshot per screen) at 130% on 411 dp, 200% on 411 dp, 200% on 360 dp, and 100% on 360 dp (AC4: nothing changes). `font-scale-sign-in` is the separate, cheap check of the note of the
 * story: the sign-in itself at 200% on 360 dp. Every step puts the display back on a failure (`onFail`), the last one after the pass, so a red run leaves the emulator as it was.
 * What a flow cannot judge - a title cut by the layout - is judged on the screenshots (docs/qa/EVM-151); the flows assert the whole text, the back action, the capsule and the testIDs.
 */

const RESET = /** @type {const} */ (['display-reset']);

/** @param {string} flow @param {import('./device.mjs').DeviceAction[]} before @param {boolean} [last] */
const tour = (flow, before, last = false) => ({
  flow,
  server: /** @type {const} */ ('ok'),
  airplane: false,
  upload: true,
  photos: /** @type {const} */ ('on'),
  before,
  onFail: [...RESET],
  ...(last ? { after: [...RESET] } : {}),
});

/** @type {import('./scenarios.mjs').Scenario[]} */
export const FONT_SCALE_SCENARIOS = [
  {
    name: 'font-scale-bars',
    ac: 'EVM-151 AC1 AC2 AC3 AC4 AC5',
    steps: [
      {
        flow: '80-camera-sign-in.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['display-reset', 'upload-reset', 'photos-reset'],
        onFail: [...RESET],
      },
      tour('150-font-scale-130.yaml', ['display:font=1.3']),
      tour('151-font-scale-200.yaml', ['display:font=2']),
      tour('152-font-scale-200-narrow.yaml', ['display:font=2,dp=360']),
      tour('153-font-scale-100-narrow.yaml', ['display:font=1,dp=360'], true),
    ],
  },
  {
    name: 'font-scale-sign-in',
    ac: 'EVM-151 AC5',
    steps: [
      {
        flow: '154-font-scale-sign-in.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['display-reset', 'upload-reset', 'photos-reset', 'display:font=2,dp=360'],
        after: [...RESET],
        onFail: [...RESET],
      },
    ],
  },
];
