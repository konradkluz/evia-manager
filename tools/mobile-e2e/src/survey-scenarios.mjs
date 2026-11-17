// @ts-check
/**
 * Scenarios of the site survey ("Wizja lokalna", EVM-137 AC1-AC7; flows 110-116 of apps/mobile/e2e). Like the upload, camera and video
 * scenarios they are outside the default run (`node tools/mobile-e2e/cli.mjs --only survey-`; docs/qa/EVM-137/plan-i-polecenia.md) and every step
 * has `upload: true`: the sign-in of the run is served by the upload part of the scenario server (src/upload-stub.mjs), because the survey
 * scenarios take photos with the real camera of the emulator (the AVD has `hw.camera.back=virtualscene`).
 *
 * The scenario server (src/sync-stub.mjs) answers the command `CreateSiteSurvey` by the modes of the step: `survey` (`ok`, `feature_disabled`,
 * `validation_failed`, `deleted`, `assigned`) and `features` (`on`, `off`: the switch the client config announces).
 *
 * The permission to use the camera: the sign-in flow starts the app WITHOUT it (`permissions: camera: unset`), the flows that need the camera get it
 * from the step `camera-grant` ahead of them. W5: the flows type invented words (src/device-survey.mjs SURVEY_SYNTHETIC_WORDS); after the
 * scenarios that send the survey the step `logcat-no-survey-data` proves the log of the device has none of them.
 */

/**
 * The first step of every scenario but the feature switch: a fresh install signs in, the server forgets the earlier scenario, the log is empty.
 * @param {import('./device.mjs').DeviceAction[]} [after]
 * @returns {import('./scenarios.mjs').Step}
 */
const signIn = (after = []) => ({
  flow: '110-survey-sign-in.yaml',
  server: 'ok',
  airplane: false,
  upload: true,
  before: ['upload-reset', 'logcat-clear'],
  ...(after.length === 0 ? {} : { after }),
});

/** The survey created with the network on and numbered `ZL-E2E-3` (preparation of the scenarios that need a survey the phone already knows). @type {import('./scenarios.mjs').Step} */
const seed = { flow: '112-survey-seed.yaml', server: 'ok', airplane: false, upload: true };

/** What the log and the data of the app must not hold after a scenario that sent a survey. @type {import('./device.mjs').DeviceAction[]} */
const CLEAN_LOG = ['tokens-not-in-clear', 'logcat-clean', 'logcat-no-survey-data'];

/** @type {import('./scenarios.mjs').Scenario[]} */
export const SURVEY_SCENARIOS = [
  // AC1 AC2 AC3 AC4: the sheet "Dodaj" has "Wizja lokalna" first; offline the survey is saved with an address only (the empty form says what is
  // missing), opens as "Oczekuje na numer", gets a photo with the category "Oględziny" already chosen; the Queue and the list show it without the
  // address; the app is stopped by force and started again offline (everything is still there); the network returns and the survey gets its number
  // and the file is sent: 2 unique mutations (the survey and the command of the file), 0 duplicates, 0 rejected; no typed value in the log.
  {
    name: 'survey-offline',
    ac: 'EVM-137 AC1 AC2 AC3 AC4',
    steps: [
      signIn(),
      { flow: '111-survey-offline.yaml', server: 'ok', airplane: true, upload: true, before: ['camera-grant'], after: ['force-stop'] },
      { flow: '111-survey-restart.yaml', server: 'ok', airplane: true, upload: true },
      {
        flow: '111-survey-return.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        expectSync: { unique: 2, duplicates: 0, rejected: 0 },
        after: CLEAN_LOG,
      },
    ],
  },
  // AC5 (W9): the mode of hidden data: the row stays in the sheet and opens a notice instead of the form, the survey is not drawn, the choice of the
  // order shows its number alone, the camera of the survey works; no typed value in the log.
  {
    name: 'survey-hidden-data',
    ac: 'EVM-137 AC5',
    steps: [
      signIn(),
      seed,
      { flow: '112-survey-hidden.yaml', server: 'ok', airplane: false, upload: true, before: ['camera-grant'], after: CLEAN_LOG },
    ],
  },
  // AC6: the survey is rejected with `feature_disabled` (the entry and the photo wait behind it): one row of "Wymaga uwagi" without the address, only
  // "Usuń z telefonu", the dialog names what goes with it, the Queue empties and the survey leaves the list (0 unique, 1 rejected).
  {
    name: 'survey-rejected',
    ac: 'EVM-137 AC6',
    steps: [
      signIn(),
      { flow: '113-survey-rejected-offline.yaml', server: 'ok', airplane: true, upload: true, before: ['camera-grant'] },
      {
        flow: '113-survey-rejected-return.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        survey: 'feature_disabled',
        expectSync: { unique: 0, duplicates: 0, rejected: 1 },
        after: CLEAN_LOG,
      },
    ],
  },
  // AC6 (W10): the server deletes the survey the phone already knows; the entry and the photo that waited are rejected `target_unavailable`: they
  // are "Wymaga uwagi" with their own words and only "Usuń z telefonu", they are not sent again; the survey leaves the list (1 unique, 2 rejected).
  {
    name: 'survey-deleted',
    ac: 'EVM-137 AC6',
    steps: [
      signIn(),
      seed,
      { flow: '114-survey-deleted-offline.yaml', server: 'ok', airplane: true, upload: true, before: ['camera-grant'] },
      {
        flow: '114-survey-deleted-return.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        survey: 'deleted',
        expectSync: { unique: 1, duplicates: 0, rejected: 2 },
        after: CLEAN_LOG,
      },
    ],
  },
  // AC7: the office gave the survey a client; the card loses the mark, the term and the chip, the details show the client, the number stays.
  {
    name: 'survey-assigned',
    ac: 'EVM-137 AC7',
    steps: [
      signIn(),
      seed,
      { flow: '115-survey-assigned.yaml', server: 'ok', airplane: false, background: true, upload: true, survey: 'assigned' },
    ],
  },
  // AC1: the function is switched off on the server: no "Wizja lokalna" in the sheet "Dodaj" (the install is fresh, so the config says it from the start).
  {
    name: 'survey-feature-off',
    ac: 'EVM-137 AC1',
    steps: [
      {
        flow: '116-survey-feature-off.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        features: 'off',
        before: ['upload-reset', 'logcat-clear'],
      },
    ],
  },
];
