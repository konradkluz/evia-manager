// @ts-check
/**
 * Scenarios of the smoke test (EVM-009 AC2, AC3, AC4): which state the scenario server and the airplane mode are in before each
 * Maestro flow (apps/mobile/e2e/*.yaml). A step fails the scenario; the next scenarios still run.
 *
 * @typedef {{
 *   flow: string,
 *   server: import('./stub-api.mjs').StubMode,
 *   airplane: boolean,
 *   background?: boolean,
 * }} Step
 * @typedef {{ name: string, ac: string, steps: Step[] }} Scenario
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'online', ac: 'AC1 AC2', steps: [{ flow: '01-online.yaml', server: 'ok', airplane: false }] },
  {
    name: 'airplane-mode-and-return',
    ac: 'AC2',
    steps: [
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
      { flow: '05-server-down.yaml', server: 'down', airplane: false },
      { flow: '06-server-retry.yaml', server: 'ok', airplane: false },
    ],
  },
  // Last: the held request keeps the app in its loading state (skeleton), and the first-flow retry of the runner is not affected.
  { name: 'loading', ac: 'AC1', steps: [{ flow: '07-loading.yaml', server: 'hang', airplane: false }] },
];

/** Waits (ms) around the state changes; they exceed the debounce of the foreground check (5 s) and the network restore. */
export const BACKGROUND_WAIT_MS = 7000;
export const NETWORK_RESTORE_WAIT_MS = 8000;
