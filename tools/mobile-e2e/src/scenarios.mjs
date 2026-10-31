// @ts-check
/**
 * Scenarios of the smoke test (EVM-009 AC2, AC3, AC4): which state the scenario server and the airplane mode are in before each
 * Maestro flow (apps/mobile/e2e/*.yaml). A step fails the scenario; the next scenarios still run.
 *
 * @typedef {{
 *   flow: string,
 *   server: import('./stub-api.mjs').StubMode,
 *   auth?: import('./stub-api.mjs').AuthMode,
 *   airplane: boolean,
 *   background?: boolean,
 *   before?: import('./device.mjs').DeviceAction[],
 *   after?: import('./device.mjs').DeviceAction[],
 * }} Step
 * `before` runs ahead of the flow (a failure skips it), `after` once the flow passed (EVM-093 device steps, src/device.mjs).
 * `auth` is the sign-in mode of the scenario server for the step (EVM-100; default `ok`).
 * @typedef {{ name: string, ac: string, steps: Step[] }} Scenario
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'online', ac: 'AC1 AC2', steps: [{ flow: '01-online.yaml', server: 'ok', airplane: false }] },
  {
    name: 'airplane-mode-and-return',
    ac: 'AC2 EVM-100 AC6',
    steps: [
      // EVM-100: a signed-in phone first, then the start without a network goes straight into the shell
      { flow: '02-sign-in.yaml', server: 'ok', airplane: false },
      { flow: '02-offline.yaml', server: 'ok', airplane: true },
      // The app goes to the background, the network returns, the app comes back to the foreground: it checks again by itself.
      { flow: '03-reconnect.yaml', server: 'ok', airplane: false, background: true },
    ],
  },
  { name: 'update-required', ac: 'AC3', steps: [{ flow: '04-update-required.yaml', server: 'update', airplane: false }] },
  {
    name: 'server-down-and-retry',
    ac: 'AC2',
    steps: [
      { flow: '05-sign-in.yaml', server: 'ok', airplane: false },
      { flow: '05-server-down.yaml', server: 'down', airplane: false },
      { flow: '06-server-retry.yaml', server: 'ok', airplane: false },
    ],
  },
  // EVM-093: the encrypted local store, through the hooks of the e2e variant and adb run-as (src/device.mjs).
  {
    name: 'local-store-encryption',
    ac: 'EVM-093 AC1',
    steps: [{ flow: '08-encryption.yaml', server: 'ok', airplane: false, after: ['check-encrypted'] }],
  },
  {
    name: 'local-store-durability',
    ac: 'EVM-093 AC3',
    steps: [
      { flow: '09-durability-seed.yaml', server: 'ok', airplane: false, after: ['force-stop'] },
      { flow: '09-durability-force-stop.yaml', server: 'ok', airplane: false, after: ['kill-9'] },
      { flow: '09-durability-kill.yaml', server: 'ok', airplane: false, after: ['reboot'] },
      { flow: '09-durability-reboot.yaml', server: 'ok', airplane: false },
    ],
  },
  // EVM-093 AC4 (decision of Konrad 2026-10-30, option a). Android 12+ (API 31+) runs `adb backup` of a DEBUGGABLE app whatever
  // allowBackup and the exclusion rules say, and the e2e variant must be debuggable for run-as (AC1, AC5, AC6): adb backup of the e2e
  // build says nothing about the release package. So adb backup of the e2e build is only the POSITIVE CONTROL (it must hold app data:
  // the transport and the parser work), and the proof is adb backup of the NOT debuggable release package of the same run, signed
  // with the debug key of the template so that `install -r` keeps the e2e data (3 entries, still there afterwards: 10-backup-after).
  // Auto Backup (bmgr, local transport) stays on the e2e variant: it follows allowBackup and the rules also for a debuggable app.
  // After install-release-debugkey the runner always puts the e2e package back (reinstall-e2e, also when a step failed).
  {
    name: 'local-store-backup',
    ac: 'EVM-093 AC4',
    steps: [
      { flow: '10-backup-seed.yaml', server: 'ok', airplane: false },
      {
        flow: '10-backup-control.yaml',
        server: 'ok',
        airplane: false,
        before: ['check-backup-transport', 'adb-backup-start'],
        after: ['adb-backup-control-check', 'install-release-debugkey'],
      },
      {
        flow: '10-backup.yaml',
        server: 'ok',
        airplane: false,
        before: ['adb-backup-start'],
        after: ['adb-backup-check', 'reinstall-e2e'],
      },
      { flow: '10-backup-after.yaml', server: 'ok', airplane: false },
    ],
  },
  { name: 'local-store-key-missing', ac: 'EVM-093 AC5', steps: [{ flow: '11-key-missing.yaml', server: 'ok', airplane: false }] },
  {
    name: 'local-store-file-corrupt',
    ac: 'EVM-093 AC5',
    steps: [
      { flow: '12-file-corrupt-seed.yaml', server: 'ok', airplane: false, after: ['force-stop', 'corrupt-db'] },
      { flow: '12-file-corrupt.yaml', server: 'ok', airplane: false },
    ],
  },
  {
    name: 'local-store-wipe',
    ac: 'EVM-093 AC6',
    steps: [
      { flow: '13-wipe-seed.yaml', server: 'ok', airplane: false, after: ['copy-db'] },
      { flow: '13-wipe.yaml', server: 'ok', airplane: false, after: ['copy-db'] },
      { flow: '13-wipe-control.yaml', server: 'ok', airplane: false },
    ],
  },
  { name: 'local-store-owner', ac: 'EVM-093 AC7', steps: [{ flow: '14-owner.yaml', server: 'ok', airplane: false }] },
  // EVM-100: the sign-in (M-01), the device states (M-02) and the sign-out (M-09) against the sign-in modes of the scenario server.
  { name: 'sign-in', ac: 'EVM-100 AC1', steps: [{ flow: '20-login-ok.yaml', server: 'ok', airplane: false }] },
  {
    name: 'sign-in-errors',
    ac: 'EVM-100 AC1 AC2',
    steps: [
      { flow: '21-login-wrong-code.yaml', server: 'ok', airplane: false },
      { flow: '21-login-rate-limited.yaml', server: 'ok', auth: 'rate_limited', airplane: false },
    ],
  },
  {
    name: 'sign-in-blocked',
    ac: 'EVM-100 AC3',
    steps: [
      { flow: '22-login-role.yaml', server: 'ok', auth: 'channel_not_allowed', airplane: false },
      { flow: '22-login-update.yaml', server: 'ok', auth: 'version_unsupported', airplane: false },
    ],
  },
  {
    name: 'session-revoked',
    ac: 'EVM-100 AC4 AC5',
    steps: [
      { flow: '23-session-sign-in.yaml', server: 'ok', airplane: false },
      { flow: '23-session-revoked.yaml', server: 'ok', auth: 'session_revoked', airplane: false },
    ],
  },
  {
    name: 'sign-in-offline',
    ac: 'EVM-100 AC6',
    steps: [
      { flow: '24-login-offline.yaml', server: 'ok', airplane: true },
      { flow: '24-login-reconnect.yaml', server: 'ok', airplane: false },
    ],
  },
  {
    name: 'sign-out',
    ac: 'EVM-100 AC6 AC7',
    steps: [
      { flow: '26-logout-online.yaml', server: 'ok', airplane: false },
      { flow: '26-logout-offline.yaml', server: 'ok', airplane: true },
      { flow: '26-logout-reconnect.yaml', server: 'ok', airplane: false },
    ],
  },
  // Last: the held request keeps the app in its loading state (skeleton), and the first-flow retry of the runner is not affected.
  {
    name: 'loading',
    ac: 'AC1',
    steps: [
      { flow: '07-sign-in.yaml', server: 'ok', airplane: false },
      { flow: '07-loading.yaml', server: 'hang', airplane: false },
    ],
  },
];

/** Waits (ms) around the state changes; they exceed the debounce of the foreground check (5 s) and the network restore. */
export const BACKGROUND_WAIT_MS = 7000;
export const NETWORK_RESTORE_WAIT_MS = 8000;
