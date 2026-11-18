// @ts-check
/**
 * Scenarios of the background upload (EVM-130 stage C, AC1–AC6; flows 50–69 of apps/mobile/e2e). They are separate from scenarios.mjs
 * (the first run of the smoke test does not include them): they need the media command `CreateMediaAsset` in the queue of the app, which comes
 * with the contract branch of EVM-131, so the orchestrator runs them on the local merge of both branches
 * (`node tools/mobile-e2e/cli.mjs --only upload-`; docs/qa/EVM-130/plan-i-polecenia.md). Every step has `upload: true`: the sign-in of the run is served by
 * the upload part of the scenario server (src/upload-stub.mjs), whose tokens the upload operations check.
 *
 * The file of a flow is injected by the hook of the e2e variant (random content made natively, nothing binary in the repository); the server
 * learns its size from the declaration of the file in `createUploadSession` (EVM-131 `file`), so the number of MiB in a flow alone decides
 * the number of parts: 40 MiB = 10 parts of 4 MiB (the part size of the run), 24 MiB = 6 parts, 1 MiB = 1 part. The delay of the
 * answer to every part (`upload-part-delay`) is the window in which the steps interrupt the app: the part is stored at once, the answer comes
 * late, so an app killed meanwhile never saw the ETag and the resume finds the part with `ListParts` instead of sending it again.
 *
 * The device and server steps are in device-upload.mjs; the interruptions are the steps `kill-9`, `force-stop`, `reboot` and the airplane mode
 * of the step. What each scenario proves and how to read a failure: docs/qa/EVM-130/plan-i-polecenia.md.
 */
import { CAMERA_SCENARIOS } from './camera-scenarios.mjs';
import { VIDEO_SCENARIOS } from './video-scenarios.mjs';
import { SURVEY_SCENARIOS } from './survey-scenarios.mjs';
import { ORDER_FILES_SCENARIOS } from './order-files-scenarios.mjs';
import { SCENARIOS } from './scenarios.mjs';

/** The answer to every part is held this long (ms): ten parts of the big file take about a minute. */
const SLOW = 5000;
/** The interruptions scenario: ten parts of 20 s, so that the file is still on its way at the last resumption before the restart of the emulator (a first run with 5 s per part ended before it). */
const SLOWER = 20_000;

/**
 * The first step of every scenario: the server forgets the earlier scenario, the log is empty, the answer to every part is held `delay` ms.
 * @param {number} delay @param {import('./device.mjs').DeviceAction[]} [more]
 * @returns {import('./scenarios.mjs').Step}
 */
const signIn = (delay, more = []) => ({
  flow: '50-upload-sign-in.yaml',
  server: 'ok',
  airplane: false,
  upload: true,
  before: ['upload-reset', 'logcat-clear', `upload-part-delay:${String(delay)}`, ...more],
});

/**
 * The checks at the end of a scenario that sent a file: nothing of a token or a signed address in the log or the files of the app.
 * @type {import('./device.mjs').DeviceAction[]}
 */
const CLEAN_LOG = ['tokens-not-in-clear', 'logcat-clean'];

/** @type {import('./scenarios.mjs').Scenario[]} */
export const UPLOAD_SCENARIOS = [
  // AC1 (and AC3 AC5 AC6): a 40 MiB file offline is in the durable queue and the job is NOT armed (no `applied` yet: no job, the server has not
  // seen a byte); after the return of the network the command is applied, the job is armed and the transfer starts; then the app is killed
  // (SIGKILL), stopped by force (the transfer starts again only when the app is opened), the network is cut in the middle of a part, and the
  // emulator is restarted. In the end: exactly one object, SHA-256 equal to the original, no orphaned multipart, at most one part sent again
  // per interruption; nothing of a token or of a signed address in the log or the files of the app.
  {
    name: 'upload-interruptions',
    ac: 'EVM-130 AC1 AC3 AC5 AC6',
    steps: [
      signIn(SLOWER),
      { flow: '51-upload-offline-inject.yaml', server: 'ok', airplane: true, upload: true, after: ['jobs-none', 'upload-none-yet'] },
      {
        flow: '52-upload-resumes.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        after: ['jobs-armed', 'notification-private', 'kill-9'],
      },
      { flow: '52-upload-resumes.yaml', server: 'ok', airplane: false, upload: true, after: ['force-stop'] },
      { flow: '52-upload-resumes.yaml', server: 'ok', airplane: false, upload: true },
      { flow: '53-upload-airplane.yaml', server: 'ok', airplane: true, upload: true },
      { flow: '52-upload-resumes.yaml', server: 'ok', airplane: false, upload: true, after: ['reboot'] },
      {
        flow: '54-upload-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['upload-checkpoint:4', 'original-present', ...CLEAN_LOG],
      },
    ],
  },
  // AC4: the original stays after the upload while the server has not confirmed `clean` (the replica says "uploading"); after `clean` the
  // original is deleted and - EVM-111 AC5 - the entry of the file leaves the phone with it (no "Wysłano" row stays).
  {
    name: 'upload-original-until-clean',
    ac: 'EVM-130 AC4',
    steps: [
      signIn(0),
      { flow: '55-upload-inject-small.yaml', server: 'ok', airplane: false, upload: true },
      { flow: '54-upload-sent.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-checkpoint:0', 'original-present'] },
      {
        flow: '54-upload-confirmed.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        before: ['upload-file-state:clean'],
        after: ['original-absent'],
      },
    ],
  },
  // AC4: `failed: checksum_mismatch` is "Nie wysłano — plik uszkodzony w transmisji" with "Ponów" (the original stays; after the retry the
  // file goes through); a quarantine is "Wymaga uwagi" without "Ponów" (the original stays).
  {
    name: 'upload-file-verdicts',
    ac: 'EVM-130 AC4',
    steps: [
      signIn(0, ['upload-verdict:checksum_mismatch']),
      { flow: '55-upload-inject-small.yaml', server: 'ok', airplane: false, upload: true },
      { flow: '57-upload-failed.yaml', server: 'ok', airplane: false, upload: true, after: ['original-present'] },
      { flow: '58-upload-retry.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-verdict:none'] },
      { flow: '55-upload-inject-small.yaml', server: 'ok', airplane: false, upload: true, before: ['upload-verdict:quarantined'] },
      { flow: '59-upload-quarantined.yaml', server: 'ok', airplane: false, upload: true, after: ['original-present'] },
    ],
  },
  // AC2 (AC3): the access token expires during the transfer; the app refreshes it by itself (one rotation at the server, no reuse), stays
  // signed in and finishes the file; the refresh token and the access token are nowhere in clear in the app data, and not in the log.
  {
    name: 'upload-token-refresh',
    ac: 'EVM-130 AC2 AC3 AC5',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-expire-access'] },
      {
        flow: '54-upload-sent.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['upload-refreshed', 'upload-checkpoint:1', ...CLEAN_LOG],
      },
    ],
  },
  // AC5: `401 session_revoked` during the transfer pauses it; the app shows "Wylogowano ten telefon", the queue stays; after a full sign-in of
  // the same user the transfer resumes and ends with one object.
  {
    name: 'upload-session-revoked',
    ac: 'EVM-130 AC5',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-fault:session_revoked'] },
      { flow: '60-upload-revoked-screen.yaml', server: 'ok', airplane: false, background: true, upload: true },
      {
        flow: '61-upload-revoked-sign-in-again.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['upload-fault-clear:session_revoked'],
        after: ['upload-checkpoint:2', ...CLEAN_LOG],
      },
    ],
  },
  // AC5: `426` during the transfer: the update screen, the work waits (no loss: the file stays on the phone).
  {
    name: 'upload-update-required',
    ac: 'EVM-130 AC5',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-fault:version_unsupported'] },
      {
        flow: '62-upload-update-required.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        after: ['original-present'],
      },
    ],
  },
  // AC5: `401 device_wipe_required` during the transfer: the company data are wiped — no job in the system, no job file, no original, no token
  // file, and nothing of a token or of a signed address in the log.
  {
    name: 'upload-device-wipe',
    ac: 'EVM-130 AC5',
    steps: [
      signIn(SLOW),
      {
        flow: '56-upload-inject-uploading.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['upload-fault:device_wipe_required'],
      },
      {
        flow: '63-upload-wipe-required.yaml',
        server: 'ok',
        airplane: false,
        background: true,
        upload: true,
        after: ['jobs-none', 'app-files-none', ...CLEAN_LOG],
      },
    ],
  },
  // AC5: "Wyczyść dane firmowe" chosen by the technician during the transfer: the same end state (step E11 of the chain runs before the
  // confirmation to the server).
  {
    name: 'upload-manual-wipe',
    ac: 'EVM-130 AC5',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true },
      {
        flow: '68-upload-manual-wipe.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        after: ['jobs-none', 'app-files-none', ...CLEAN_LOG],
      },
    ],
  },
  // AC5: the mode of hidden data (no contact with the server for 8 days): the transfer goes on and ends with one object, and the worker does
  // not bring the data back (the screen of hidden data is still there afterwards).
  {
    name: 'upload-hidden-data',
    ac: 'EVM-130 AC5',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true },
      { flow: '64-upload-hidden.yaml', server: 'ok', airplane: false, upload: true, after: ['upload-checkpoint:2'] },
      { flow: '65-upload-hidden-still.yaml', server: 'ok', airplane: false, upload: true },
    ],
  },
  // AC6: the notification of the transfer as the system keeps it (low channel, private with a public version, the texts of the story, no
  // personal data, no buttons).
  {
    name: 'upload-notification',
    ac: 'EVM-130 AC6',
    steps: [
      signIn(SLOW),
      { flow: '56-upload-inject-uploading.yaml', server: 'ok', airplane: false, upload: true, after: ['notification-private'] },
    ],
  },
  // AC6: without permission to notify the Queue shows the banner "Powiadomienia wyłączone …" with "Włącz powiadomienia"; with the permission
  // the banner is gone. The file waits offline, so there is something unsent.
  {
    name: 'upload-permission-banner',
    ac: 'EVM-130 AC6',
    steps: [
      signIn(SLOW),
      { flow: '51-upload-offline-inject.yaml', server: 'ok', airplane: true, upload: true },
      { flow: '66-upload-banner.yaml', server: 'ok', airplane: true, upload: true },
      { flow: '67-upload-banner-gone.yaml', server: 'ok', airplane: true, upload: true, before: ['notifications-grant'] },
    ],
  },
];

/**
 * The scenarios a run takes: without `only` the scenarios of scenarios.mjs; with it the scenarios (those and the upload ones) whose name
 * is, or starts with, one of the given words (the upload scenarios and, from EVM-108, the camera ones `camera-`, from EVM-110 the film ones
 * `video-`, from EVM-137 the site survey ones `survey-`, from EVM-111 `order-files`).
 * @param {string[] | null} only
 * @returns {import('./scenarios.mjs').Scenario[]}
 */
export function selectScenarios(only) {
  if (only === null) return SCENARIOS;
  return [...SCENARIOS, ...UPLOAD_SCENARIOS, ...CAMERA_SCENARIOS, ...VIDEO_SCENARIOS, ...SURVEY_SCENARIOS, ...ORDER_FILES_SCENARIOS].filter(
    (scenario) => only.some((word) => scenario.name.startsWith(word)),
  );
}
