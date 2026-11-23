// @ts-check
/**
 * Scenarios of the photos of an order (EVM-142 AC2-AC5; flows 140-143 of apps/mobile/e2e). Like the camera and lock scenarios they are outside the default run
 * (`node tools/mobile-e2e/cli.mjs --only photos-`); the sign-in of the run is served by the upload part of the scenario server (`upload: true`) and the replica carries the
 * five photos of the order ZL-E2E-1 (`photos: 'on'`: three `ready`, one `processing`, one in quarantine). The addresses and the pictures come from the photos part of the
 * scenario server (src/photos-stub.mjs), which answers every picture with `Cache-Control: private, max-age=300` on purpose (the worst case for a cache on the disk).
 *
 * - `photos-grid` (AC2 AC6): the row "Zdjęcia zlecenia" with the count, the tiles "[category], [time]", the texts of the states; the server saw the thumbnails of the three
 *   ready photos and NO request for the two others, no preview, no original.
 * - `photos-preview` (AC3 AC4): the preview with the category, the time, the description and the close; an expired address (403) is renewed ONCE (two addresses, two
 *   requests); a 500 says "Nie udało się wczytać zdjęcia" with "Spróbuj ponownie" and asks for NO second address; the retry after the fault is gone; a 429 of the address
 *   (the limit) says the same and the retry after the `Retry-After` works.
 * - `photos-offline` (AC4): airplane mode - the grid from the replica with "Podgląd zdjęć wymaga internetu" and no request; the network back - the thumbnails load by themselves.
 * - `photos-no-trace` (AC5): the PROOF that nothing of a picture stays on the phone. Baseline of the install (the files whose contents hold `WEBPVP8` or the marker `E2EMARK`, the
 *   HTTP cache of the app client, the log), then the grid and a preview with an expired address, a failed load (500), a lock with the download in progress, a logout, "Wyczyść dane firmowe";
 *   after each stage the same search and the same log filter. At the end the POSITIVE CONTROL on the same install: the hook fetches a picture WITHOUT `Cache-Control: no-store`
 *   and the same search MUST find it in the HTTP cache, and the same filter MUST find the line E2EMARK-CTRL - otherwise the whole proof is void.
 */

/** The sign-in step that every scenario starts with: a fresh install without the camera permission, the first download with the photos in the replica. */
const SIGN_IN = {
  flow: '80-camera-sign-in.yaml',
  server: /** @type {const} */ ('ok'),
  airplane: false,
  upload: true,
  photos: /** @type {const} */ ('on'),
};

/** @type {import('./scenarios.mjs').Scenario[]} */
export const PHOTOS_SCENARIOS = [
  {
    name: 'photos-grid',
    ac: 'EVM-142 AC2 AC6',
    steps: [
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset'] },
      {
        flow: '140-photos-grid.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        // the three ready photos, one request for an address and one for the picture each; none for the processing and the quarantined one; nothing but thumbnails
        after: [
          'photos-requests:thumbnailUrls=3,thumbnailImages=3,previewUrls=0,previewImages=0,originalUrls=0,unreadyUrls=0',
          'photos-headers',
        ],
      },
      { flow: '140-photos-grid-after.yaml', server: 'ok', airplane: false, upload: true, photos: 'on', after: ['photos-logcat-clean'] },
    ],
  },
  {
    name: 'photos-preview',
    ac: 'EVM-142 AC3 AC4',
    steps: [
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset'] },
      // the first request of a preview is answered 403 (an expired address): ONE more address and ONE more request, silently
      {
        flow: '141-photos-preview-open.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault:image:403:1:preview'],
        after: ['photos-requests:previewUrls=2,previewImages=2,failedImages=1', 'photos-wait:2000'],
      },
      {
        flow: '141-photos-preview-shown.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        after: ['photos-requests:previewUrls=2,previewImages=2'],
      },
      // every request of a preview is answered 500: the message and the button; a 500 is no expired address - no second address request
      {
        flow: '141-photos-preview-error.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault:image:500:0:preview'],
        after: ['photos-requests:previewUrls=3,previewImages=3,failedImages=2'],
      },
      // the server is well again: the retry asks for a NEW address
      {
        flow: '141-photos-preview-retry.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault-clear'],
        after: ['photos-requests:previewUrls=4,previewImages=4,failedImages=2'],
      },
      // the API answers the request for an address with 429 (the limit): the same message
      {
        flow: '141-photos-preview-limit.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault:url:429:1:preview'],
        after: ['photos-requests:previewUrls=5,previewImages=4'],
      },
      // the `Retry-After` (5 s) is over: the retry works
      {
        flow: '141-photos-preview-limit-retry.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-wait:7000'],
        after: ['photos-requests:previewUrls=6,previewImages=5', 'photos-headers', 'photos-logcat-clean'],
      },
    ],
  },
  {
    name: 'photos-offline',
    ac: 'EVM-142 AC4',
    steps: [
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset'] },
      // no network: the replica is listed, no request leaves the phone
      {
        flow: '142-photos-offline.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        photos: 'on',
        after: ['photos-requests:thumbnailUrls=0,previewUrls=0,thumbnailImages=0,previewImages=0'],
      },
      // the network is back: the thumbnails load by themselves
      {
        flow: '142-photos-online.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        // measured: the reload after the return of the network asks twice for the same three thumbnails (6 addresses, 6 requests) - a finding of the report, not a failure of AC4
        after: ['photos-requests:thumbnailUrls>=3,thumbnailImages>=3,unreadyUrls=0,previewUrls=0', 'photos-headers'],
      },
    ],
  },
  {
    name: 'photos-no-trace',
    ac: 'EVM-142 AC5',
    steps: [
      // the baseline: the install after the sign-in, before a single picture was viewed
      { ...SIGN_IN, before: ['upload-reset', 'photos-reset'], after: ['photos-disk-baseline', 'gallery-baseline'] },
      // the grid, a preview with an expired address (renewed once)
      {
        flow: '143-photos-view.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault:image:403:1:preview'],
        after: [
          'photos-requests:thumbnailImages>=3,previewUrls=2,previewImages=2,failedImages=1',
          'photos-wait:1500',
          'photos-disk-check',
          'photos-logcat-clean',
          'photos-headers',
        ],
      },
      {
        flow: '143-photos-view-close.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        after: ['photos-disk-check', 'photos-logcat-clean'],
      },
      // a failed load (500)
      {
        flow: '143-photos-view-error.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault:image:500:0:preview'],
        after: ['photos-requests:previewImages>=3,failedImages>=2', 'photos-disk-check', 'photos-logcat-clean'],
      },
      // the preview open with the download in progress (the server holds the picture for 100 s): the positive control of the tree read, then the lock
      {
        flow: '143-photos-lock-open.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-fault-clear', 'photos-delay:100000'],
        after: ['photos-view-tree-unlocked'],
      },
      {
        flow: '143-photos-lock.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        after: ['photos-view-tree-locked', 'photos-requests:abandoned>=1', 'photos-disk-check', 'photos-logcat-clean'],
      },
      // a cold start, the photos again, the sign-out
      {
        flow: '143-photos-logout.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        before: ['photos-delay:0'],
        after: ['photos-disk-check', 'photos-logcat-clean', 'photos-headers'],
      },
      // the sign-in again, the photos again, "Wyczyść dane firmowe"
      {
        flow: '143-photos-wipe.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        after: ['photos-disk-check', 'photos-logcat-clean', 'photos-headers', 'gallery-unchanged'],
      },
      // the POSITIVE CONTROL on the same install: a picture fetched WITHOUT no-store MUST be found by the same search and the same log filter
      {
        flow: '143-photos-control.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        photos: 'on',
        after: ['photos-control-check'],
      },
    ],
  },
];
