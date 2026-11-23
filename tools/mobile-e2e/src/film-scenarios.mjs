// @ts-check
/**
 * Scenarios of the film player of an order (EVM-143 AC2-AC6; flows 160-165 of apps/mobile/e2e). Like the photo scenarios they are outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only film-`); the sign-in of the run is served by the upload part of the scenario server (`upload: true`) and the replica carries the five photos of
 * the order ZL-E2E-1 AND one ready film (`photos: 'videos'`: the newest tile). The addresses, the thumbnail and the MP4 come from the photos part of the scenario server
 * (src/photos-stub.mjs); the MP4 is a real H.264 file of the Android SDK of the machine (`EVIA_E2E_VIDEO_FIXTURE` overrides), served with ranges and
 * `Cache-Control: private, max-age=300` on purpose (the worst case for a cache on the disk).
 *
 * - `film-play` (AC1 AC2 AC3 AC6): the grid with the film (the row "..., 1 film", the tile "Film, [category], [time]"; NO request for the film before "Odtwórz"), the player: "Odtwórz",
 *   "Pauza", "Odtwórz", "Odtwórz ponownie" at the end; an address that is already expired is renewed ONCE, silently; a 500 says "Nie udało się odtworzyć filmu" with "Spróbuj ponownie"
 *   and the retry after the fault plays; the requests carry no `Authorization`, no `Cookie`, no `_=`.
 * - `film-offline` (AC4): airplane mode - "Film wymaga internetu", no request; the network back - nothing starts by itself, the manual retry plays.
 * - `film-no-trace` (AC5): the PROOF that nothing of a film stays on the phone. Baseline of the install, then the film played and closed, a lock with the film playing (the download in
 *   progress), a background, a logout, "Wyczyść dane firmowe"; after each stage the same search (content `ftyp`, the marker of the addresses, the names `*.mp4` `*.exo`, the HTTP cache) and the
 *   same log filter. At the end the POSITIVE CONTROL of the search: a planted file MUST be found by the same search. AC6: the merged manifest of the installed app.
 * - `film-font-scale` (AC6; the open note of EVM-142): the grid and the player at 130% / 411 dp, 200% / 411 dp, 200% / 360 dp, WITH scrolling to the button.
 */

const SIGN_IN = {
  flow: '80-camera-sign-in.yaml',
  server: /** @type {const} */ ('ok'),
  airplane: false,
  upload: true,
  photos: /** @type {const} */ ('videos'),
};

/** @param {string} flow @param {Partial<import('./scenarios.mjs').Step>} [more] @returns {import('./scenarios.mjs').Step} */
const step = (flow, more = {}) => ({ flow, server: 'ok', airplane: false, upload: true, photos: 'videos', ...more });

const RESET = /** @type {const} */ (['display-reset']);
/** @param {string} flow @param {import('./device.mjs').DeviceAction[]} before @param {boolean} [last] @returns {import('./scenarios.mjs').Step} */
const tour = (flow, before, last = false) => step(flow, { before, onFail: [...RESET], ...(last ? { after: [...RESET] } : {}) });

/** @type {import('./scenarios.mjs').Scenario[]} */
export const FILM_SCENARIOS = [
  {
    name: 'film-play',
    ac: 'EVM-143 AC1 AC2 AC3 AC6',
    steps: [
      {
        ...SIGN_IN,
        before: ['upload-reset', 'photos-reset', 'film-fixture', 'film-throttle:0'],
        after: ['film-manifest', 'permissions-minimal'],
      },
      // the grid: the film is a tile; nothing of the film was asked for
      step('160-film-grid.yaml', { after: ['film-requests:urls=0,requests=0,bytes=0'] }),
      // the player: Odtwórz / Pauza / Odtwórz / Odtwórz ponownie
      step('160-film-play.yaml', {
        onFail: ['film-requests:urls>=0,requests>=0,ranges>=0,ok>=0,failed>=0,abandoned>=0,bytes>=0'],
        after: ['film-requests:urls=1,ranges>=1,ok>=1', 'film-headers'],
      }),
      // an address that is already expired: ONE silent renewal (two addresses), the film goes on
      step('161-film-expired.yaml', {
        before: ['photos-reset', 'film-expire:1'],
        after: ['film-requests:urls=2,failed>=1,ok>=1', 'film-headers'],
      }),
      // 500 on every request for the film: the message and the button
      step('162-film-error.yaml', { before: ['photos-reset', 'photos-fault:video:500:0'], after: ['film-requests:urls>=2,failed>=2'] }),
      // the server is well again: the retry plays
      step('162-film-retry.yaml', { before: ['photos-fault-clear'], after: ['film-requests:ok>=1', 'photos-logcat-clean'] }),
    ],
  },
  {
    name: 'film-offline',
    ac: 'EVM-143 AC4',
    steps: [
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset', 'film-fixture', 'film-throttle:0'] },
      // no network: the notice, no request for the film
      step('163-film-offline.yaml', { airplane: true, after: ['film-requests:urls=0,requests=0'] }),
      // the network is back: nothing starts by itself
      step('163-film-online.yaml', { before: ['photos-wait:6000'], after: ['film-requests:urls=0,requests=0'] }),
      // the manual retry plays
      step('163-film-online-retry.yaml', { after: ['film-requests:urls=1,ok>=1', 'film-headers'] }),
    ],
  },
  {
    name: 'film-no-trace',
    ac: 'EVM-143 AC5 AC6',
    steps: [
      // the baseline: the install after the sign-in, before a single film was played
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset', 'film-fixture', 'film-throttle:0'], after: ['film-disk-baseline'] },
      // the film played, paused, closed
      step('164-film-view.yaml', {
        after: ['film-requests:urls=1,ok>=1', 'film-disk-check', 'photos-logcat-clean', 'film-headers'],
      }),
      // the film playing with the download in progress (the server serves it slowly), then the lock
      step('164-film-lock-open.yaml', { before: ['photos-reset', 'film-throttle:5000'] }),
      step('164-film-lock.yaml', { after: ['film-requests:abandoned>=1', 'film-disk-check', 'photos-logcat-clean'] }),
      // a cold start, the film playing, the background
      step('164-film-background.yaml', { after: ['film-requests:abandoned>=2', 'film-disk-check', 'photos-logcat-clean'] }),
      // the film played again, the sign-out
      step('164-film-logout.yaml', { before: ['film-throttle:0'], after: ['film-disk-check', 'photos-logcat-clean', 'film-headers'] }),
      // the sign-in again, the film played, "Wyczyść dane firmowe"
      // ... and the POSITIVE CONTROL of the search on the same install: a planted file MUST be found by the same search
      step('164-film-wipe.yaml', { after: ['film-disk-check', 'photos-logcat-clean', 'film-headers', 'film-disk-control'] }),
    ],
  },
  {
    name: 'film-font-scale',
    ac: 'EVM-143 AC6; EVM-142 note',
    steps: [
      { ...SIGN_IN, before: ['display-reset', 'upload-reset', 'photos-reset', 'film-fixture', 'film-throttle:0'], onFail: [...RESET] },
      tour('165-film-font-scale-130.yaml', ['display:font=1.3']),
      tour('165-film-font-scale-200.yaml', ['display:font=2']),
      tour('165-film-font-scale-200-narrow.yaml', ['display:font=2,dp=360'], true),
    ],
  },
];
