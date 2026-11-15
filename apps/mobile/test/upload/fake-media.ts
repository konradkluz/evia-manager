// A fake of the files of the queue seen by the screens (EVM-130): a settable snapshot, recorded calls.
import { CapturePipeline, type CapturePorts, type VideoRecording, type VideoSource } from '../../src/capture/capture-pipeline';
import type { MediaControl, MediaUploadsSnapshot } from '../../src/upload/types';

export class FakeMedia implements MediaControl {
  snapshot: MediaUploadsSnapshot = { files: [], notifications: 'granted' };
  launchTarget: 'queue' | null = null;
  retryResult = true;
  consent: 'granted' | 'denied' = 'granted';
  readonly calls: string[] = [];
  /** The ports of the pipeline the camera gets (set by the test; `takePicture` is the one the screen passes). */
  capturePorts: Omit<CapturePorts, 'takePicture'> | null = null;
  /** Free bytes of the phone; `null` = unknown. */
  freeBytes: number | null = null;
  /** When set, the free space is read from here at every call (a test that changes it between shots). */
  freeSource: (() => number | null) | null = null;
  /** The pipelines made so far (the test waits for their saves). */
  readonly pipelines: CapturePipeline[] = [];
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): MediaUploadsSnapshot => this.snapshot;

  /** Replaces the snapshot and tells the screens. */
  set(snapshot: MediaUploadsSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.#listeners]) listener();
  }

  retry(assetId: string): Promise<boolean> {
    this.calls.push(`retry:${assetId}`);
    return Promise.resolve(this.retryResult);
  }

  /** What `discard` answers; the assets it was asked about are recorded in `calls`. */
  discardResult = true;
  discard(assetId: string): Promise<boolean> {
    this.calls.push(`discard:${assetId}`);
    return Promise.resolve(this.discardResult);
  }

  requestNotifications(): Promise<'granted' | 'denied'> {
    this.calls.push('requestNotifications');
    return Promise.resolve(this.consent);
  }

  openNotificationSettings(): Promise<boolean> {
    this.calls.push('openNotificationSettings');
    return Promise.resolve(true);
  }

  consumeLaunchTarget(): 'queue' | null {
    this.calls.push('consumeLaunchTarget');
    const target = this.launchTarget;
    this.launchTarget = null;
    return target;
  }

  /** The recording in progress, as the pipeline reports it (EVM-110); `stopRecording` stops it like the real queue does. */
  recording: VideoRecording | null = null;
  readonly stopCalls: number[] = [];

  /** What `consumeInterruptedRecording` answers (once). */
  interrupted = false;
  /** The calls of `keepScreenOn`, in order. */
  readonly keepAwake: boolean[] = [];

  consumeInterruptedRecording(): Promise<boolean> {
    const was = this.interrupted;
    this.interrupted = false;
    return Promise.resolve(was);
  }

  keepScreenOn(on: boolean): void {
    this.keepAwake.push(on);
  }

  async stopRecording(timeoutMs = 3000): Promise<void> {
    this.stopCalls.push(timeoutMs);
    this.recording?.stop('interrupted');
    await this.recording?.done;
  }

  capturePipeline(takePicture: CapturePorts['takePicture'], video?: VideoSource): CapturePipeline {
    const base = this.capturePorts;
    if (base === null) throw new Error('the test sets capturePorts first');
    const pipeline = new CapturePipeline({
      ...base,
      takePicture,
      ...(video === undefined
        ? {}
        : {
            video,
            onRecording: (recording: VideoRecording | null) => {
              this.recording = recording;
              base.onRecording?.(recording);
            },
          }),
    });
    this.pipelines.push(pipeline);
    return pipeline;
  }

  freeDiskBytes(): number | null {
    return this.freeSource?.() ?? this.freeBytes;
  }

  refresh(): Promise<void> {
    this.calls.push('refresh');
    return Promise.resolve();
  }
}
