/**
 * The ONE options object of `takePictureAsync` (EVM-108 AC1; SR-FILE-08, SR-MOB-02): a constant, frozen, built nowhere else — a test pins its exact
 * content and the source of the screen. The library writes the picture into its private cache (`cacheDir/Camera/`), the native import then
 * takes it over (`importOriginal`); nothing here asks for metadata, a copy in the text form or a callback.
 */
export const PICTURE_OPTIONS = Object.freeze({ quality: 0.9 });

/** The one memory of the process: the notification consent was already shown after a first "Gotowe" (AC2; never stored, a restart asks again). */
export const consentMemory = { shown: false };

/** The longest recording (EVM-110 AC2; decision of Konrad, 2026-11-15): 5 minutes at 720p and 5 Mb/s is about 190 MB. */
export const VIDEO_MAX_SECONDS = 300;
/** The warning "Za minutę koniec nagrania" appears one minute before the limit. */
export const VIDEO_WARN_AT_SECONDS = VIDEO_MAX_SECONDS - 60;

/**
 * The props of the VIEW in the video mode (EVM-110 AC1, AC7; SEC-110-02): one frozen constant, built nowhere else - a test pins its exact content and the
 * source of the screen. `mute: true` is what keeps the library from asking for the microphone (`RECORD_AUDIO` is forbidden in the package) and gives a
 * file without a sound track; it is set in EVERY mode, bound to this constant, never to a state. `videoQuality` 720p and `videoBitrate` 5 Mb/s keep the
 * film at about 37.5 MB per minute.
 */
export const VIDEO_VIEW_PROPS = Object.freeze({ mute: true, videoQuality: '720p', videoBitrate: 5_000_000 } as const);

/**
 * The options of `recordAsync` (EVM-110 AC1, AC2; SEC-110-02): the time limit is the constant; `maxFileSize` is the only value computed at the start
 * (`videoSizeLimit`) and is never `0` (the library reads 0 as "no limit"). Nothing else is passed: no location, no codec, no audio.
 */
export const VIDEO_OPTIONS_BASE = Object.freeze({ maxDuration: VIDEO_MAX_SECONDS } as const);

export function videoRecordOptions(maxFileSize: number): Readonly<{ maxDuration: number; maxFileSize: number }> {
  return Object.freeze({ ...VIDEO_OPTIONS_BASE, maxFileSize });
}
