// The scripted camera and the files of the phone for the tests of the film (EVM-110): shared by the durability tests and the tests of the end of the session.
import type { VideoSource } from '../../src/capture/capture-pipeline';
import type { NativeUpload } from '../../src/upload/native-upload';

export const SHA = 'f'.repeat(64);
export const MB = 1024 * 1024;

/** The camera: `record` hands the test the way to end the recording; `stop` is what the library's `stopRecording` does (ends the file and resolves). */
export class ScriptedCamera implements VideoSource {
  readonly options: unknown[] = [];
  stops = 0;
  #finish: ((value: { uri: string } | null) => void) | undefined;
  #fail: ((error: Error) => void) | undefined;
  /** When `false` the library does not end the recording on `stop` (a stuck recorder): the test ends it. */
  endsOnStop = true;

  record(options: Readonly<{ maxDuration: number; maxFileSize: number }>): Promise<{ uri: string } | null> {
    this.options.push(options);
    return new Promise((resolve, reject) => {
      this.#finish = resolve;
      this.#fail = reject;
    });
  }

  stop(): void {
    this.stops += 1;
    if (this.endsOnStop) this.end();
  }

  /** The library resolves with the file (at a limit, at `stopRecording`). */
  end(uri: string | null = 'file:///cache/Camera/3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4'): void {
    this.#finish?.(uri === null ? null : { uri });
  }

  crash(): void {
    this.#fail?.(new Error('synthetic recorder failure'));
  }
}

/** The files of the phone for a film: the cache of the camera and the private folder of the originals. */
export class PhoneFiles {
  readonly cache = new Map<string, number>([['file:///cache/Camera/3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4', 78 * MB]]);
  readonly originals = new Map<string, number>();
  readonly imports: { assetId: string; mediaType: string }[] = [];
  importResult: 'ok' | 'no_space' | 'io_error' = 'ok';
  digestNull = false;

  native(): Pick<NativeUpload, 'importOriginal' | 'sweepOriginals' | 'cancelUpload' | 'digestOriginal'> {
    return {
      importOriginal: (assetId, uri, mediaType) => {
        this.imports.push({ assetId, mediaType });
        if (this.importResult !== 'ok') {
          this.cache.delete(uri);
          return Promise.resolve(this.importResult);
        }
        const size = this.cache.get(uri);
        if (size === undefined) return Promise.resolve('source_missing');
        this.originals.set(assetId, size);
        this.cache.delete(uri);
        return Promise.resolve('ok');
      },
      digestOriginal: (assetId) => {
        const size = this.originals.get(assetId);
        return Promise.resolve(size === undefined || this.digestNull ? null : { sizeBytes: size, sha256: SHA });
      },
      cancelUpload: (assetId, deleteOriginal) => {
        if (deleteOriginal) this.originals.delete(assetId);
        return Promise.resolve(true);
      },
      sweepOriginals: () => Promise.resolve(0),
    };
  }
}

export const nativeOf = (phone: PhoneFiles): NativeUpload => ({
  ...phone.native(),
  reconcile: (items) => Promise.resolve(Object.fromEntries(items.map((item) => [item.assetId, 'armed' as const]))),
  retryUpload: () => Promise.resolve('armed'),
  setKeepScreenOn: () => true,
  getVideoWifiOnly: () => true,
  setVideoWifiOnly: () => Promise.resolve(true),
  completeUpload: () => Promise.resolve('keep'),
  uploadStatuses: () => Promise.resolve([]),
  wipeUploads: () => Promise.resolve(true),
  notificationPermission: () => 'granted',
  requestNotificationPermission: () => Promise.resolve('granted'),
  openNotificationSettings: () => Promise.resolve(true),
  launchTarget: () => null,
  e2eInjectFile: () => Promise.resolve(null),
  addListener: () => ({ remove: (): void => undefined }),
});
