/**
 * The ONE options object of `takePictureAsync` (EVM-108 AC1; SR-FILE-08, SR-MOB-02): a constant, frozen, built nowhere else — a test pins its exact
 * content and the source of the screen. The library writes the picture into its private cache (`cacheDir/Camera/`), the native import then
 * takes it over (`importOriginal`); nothing here asks for metadata, a copy in the text form or a callback.
 */
export const PICTURE_OPTIONS = Object.freeze({ quality: 0.9 });

/** The one memory of the process: the notification consent was already shown after a first "Gotowe" (AC2; never stored, a restart asks again). */
export const consentMemory = { shown: false };
