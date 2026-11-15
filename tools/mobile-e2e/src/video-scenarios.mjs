// @ts-check
/**
 * Scenarios of the film mode of the camera (EVM-110; flows 90-9x of apps/mobile/e2e). Like the camera and upload scenarios they are outside the
 * default run (`node tools/mobile-e2e/cli.mjs --only video-`) and every step has `upload: true`: the sign-in of the run is served by the upload part of
 * the scenario server. The sign-in flow is the one of the camera scenarios (`80-camera-sign-in.yaml`: a fresh install without the permission for the
 * camera); the step that records gets the permission from `camera-grant` ahead of it.
 *
 * `video-record` is the SMOKE flow (stage 2 of EVM-110): the real camera of the emulator (the virtual scene) records for a few seconds through
 * `recordAsync` of expo-camera, the film is saved without a network and shows in the Queue as a row of a film (length, size). It judges neither the
 * content of the MP4 (no sound track, no location: stage 4) nor the sending.
 */

/** @type {import('./scenarios.mjs').Scenario[]} */
export const VIDEO_SCENARIOS = [
  {
    name: 'video-record',
    ac: 'EVM-110 AC1 AC2 AC6',
    steps: [
      {
        flow: '80-camera-sign-in.yaml',
        server: 'ok',
        airplane: false,
        upload: true,
        before: ['upload-reset', 'logcat-clear', 'upload-part-delay:0'],
      },
      {
        flow: '90-video-record.yaml',
        server: 'ok',
        airplane: true,
        upload: true,
        before: ['camera-grant'],
        after: ['permissions-minimal', 'upload-none-yet'],
      },
    ],
  },
];
