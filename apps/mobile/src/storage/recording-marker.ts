import { createAppFiles } from './platform';

/**
 * The marker of a film being recorded (EVM-110 AC3): a tiny file in the files of the app (`filesDir`, not backed up), written when a recording starts and removed
 * when it ends. A process killed in the middle leaves it, so the next start can say once that the previous recording was not saved. The file holds one
 * character and nothing about the order, the customer or the film.
 */
const NAME = 'recording.marker';

export function createRecordingMarker(files: ReturnType<typeof createAppFiles> = createAppFiles()) {
  return {
    set: (): Promise<void> => files.write(NAME, '1'),
    clear: (): Promise<void> => files.remove(NAME),
    present: async (): Promise<boolean> => (await files.read(NAME)) !== null,
  };
}

let real: ReturnType<typeof createRecordingMarker> | undefined;
const marker = (): ReturnType<typeof createRecordingMarker> => (real ??= createRecordingMarker());

/** The marker of the process, on the real files (created at first use, so importing this module touches no file system). */
export const recordingMarker = {
  set: (): Promise<void> => marker().set(),
  clear: (): Promise<void> => marker().clear(),
  present: (): Promise<boolean> => marker().present(),
};
