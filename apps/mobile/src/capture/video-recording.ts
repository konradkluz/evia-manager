/**
 * One recording of a film (EVM-110 AC2, AC3): pure logic on ports - no screen, no native call of its own. The library ends a recording at a limit (time,
 * size) or at `stopRecording` and in every such case RESOLVES with the file, so the reason is decided here: the last progress event (`duration`, `fileSize`)
 * and the one who asked for the stop. The recording tells the free space on every progress event and stops the film itself below 100 MB.
 * The handle is the only thing that stops a recording: `stop` is idempotent, the first reason wins.
 */
import { VIDEO_MAX_SECONDS, videoRecordOptions } from './camera-options';
import { VIDEO_STOP_BELOW_BYTES, type DiskSpace } from './disk-space';

/** The camera as the recording sees it: `recordAsync` of the view and its `stopRecording`. */
export interface VideoSource {
  /** Resolves with the file when the recording ends (also at a limit); `null` = nothing was recorded. */
  record(options: Readonly<{ maxDuration: number; maxFileSize: number }>): Promise<{ readonly uri: string } | null>;
  /** Asks the library to stop (it ends the file and resolves `record`); never throws. */
  stop(): void;
}

/** Why a film ended: the time limit, the safety limit of the size, the free space, the technician (shutter) or the app (it lost the foreground, back, the end of the session). */
export type VideoEnd = 'time_limit' | 'size_limit' | 'no_space' | 'stopped' | 'interrupted';

export type VideoResult =
  | { readonly ok: true; readonly assetId: string; readonly sizeBytes: number; readonly durationMs: number; readonly end: VideoEnd }
  | {
      readonly ok: false;
      readonly code: 'no_space' | 'save_failed' | 'camera_failed' | 'busy' | 'no_session';
      /** Which step said no (`import_io_error`, `digest`, `register_enqueue_failed`, `record_rejected`, ...): a code, never a path or a message (the e2e variant shows it). */
      readonly reason?: string;
    };

/** The progress of the library (`onRecordingProgress`): seconds and bytes recorded so far. */
export interface VideoProgress {
  readonly duration: number;
  readonly fileSize: number;
}

export type StopReason = 'user' | 'interrupted';

/** What a size limit looks like from the outside: the recorder stops a few percent before the number it was given. */
const SIZE_LIMIT_SHARE = 0.98;

export class VideoRecording {
  readonly #source: VideoSource;
  readonly #disk: DiskSpace;
  readonly #maxFileSize: number;
  #reason: VideoEnd | null = null;
  #duration = 0;
  #size = 0;
  /** The time the recording was asked for (ms), for the capture time and for a film that never sent a progress event. */
  readonly startedAt: number;
  readonly #now: () => number;
  /** Resolves when the library has ended the recording (the file is written, the save has not run yet) - "Zapisywanie filmu…" starts here; never rejects. */
  readonly recorded: Promise<void>;
  /** Resolves when the file is saved (or the recording failed); never rejects. */
  readonly done: Promise<VideoResult>;

  constructor(deps: {
    readonly source: VideoSource;
    readonly disk: DiskSpace;
    readonly now: () => number;
    readonly maxFileSize: number;
    /** The durable save of the file the recording produced: import, digest, one transaction. */
    readonly save: (uri: string, end: VideoEnd, durationMs: number, startedAt: number) => Promise<VideoResult>;
  }) {
    this.#source = deps.source;
    this.#disk = deps.disk;
    this.#maxFileSize = deps.maxFileSize;
    this.#now = deps.now;
    this.startedAt = deps.now();
    let recorded: () => void = () => undefined;
    this.recorded = new Promise<void>((resolve) => {
      recorded = resolve;
    });
    this.done = this.#start(deps.save, recorded);
  }

  #start(
    save: (uri: string, end: VideoEnd, durationMs: number, startedAt: number) => Promise<VideoResult>,
    recorded: () => void,
  ): Promise<VideoResult> {
    let recording: Promise<{ readonly uri: string } | null>;
    try {
      recording = this.#source.record(videoRecordOptions(this.#maxFileSize));
    } catch {
      recording = Promise.reject(new Error('record failed'));
    }
    return recording.finally(recorded).then(
      (file) =>
        file === null
          ? ({ ok: false, code: 'camera_failed', reason: 'record_empty' } as const)
          : save(file.uri, this.#end(), this.durationMs(), this.startedAt),
      () => ({ ok: false, code: 'camera_failed', reason: 'record_rejected' }) as const,
    );
  }

  /** The recorded seconds so far (the last progress event). */
  get seconds(): number {
    return this.#duration;
  }

  /** The length of the film in milliseconds: the library's own count, else the wall time since the start. */
  durationMs(): number {
    return this.#duration > 0 ? Math.round(this.#duration * 1000) : Math.max(0, this.#now() - this.startedAt);
  }

  /** One progress event: remembers it and stops the film when the free space of the phone fell below the stop threshold. */
  progress(event: VideoProgress): void {
    if (Number.isFinite(event.duration) && event.duration >= 0) this.#duration = event.duration;
    if (Number.isFinite(event.fileSize) && event.fileSize >= 0) this.#size = event.fileSize;
    const free = this.#disk.freeBytes();
    if (free !== null && Number.isFinite(free) && free >= 0 && free < VIDEO_STOP_BELOW_BYTES) this.#halt('no_space');
  }

  /** Stops the recording; the file is saved like any other film. The first reason wins; calling it again only repeats the request to the library. */
  stop(reason: StopReason = 'user'): void {
    this.#halt(reason === 'user' ? 'stopped' : 'interrupted');
  }

  #halt(reason: VideoEnd): void {
    this.#reason ??= reason;
    try {
      this.#source.stop();
    } catch {
      // the library ends the recording by itself in the worst case; the save still runs when `record` resolves
    }
  }

  #end(): VideoEnd {
    if (this.#reason !== null) return this.#reason;
    if (this.#duration >= VIDEO_MAX_SECONDS - 1) return 'time_limit';
    if (this.#size >= this.#maxFileSize * SIZE_LIMIT_SHARE) return 'size_limit';
    return 'stopped';
  }
}
