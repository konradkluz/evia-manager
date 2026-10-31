/**
 * A video processor for the tests of the units and of the integration (EVM-046): `probe` reads the whole original (so the checks of the stream in the
 * caller run), calls `beforeProcessing` like the real adapter and answers with a probe or with what `probeBehaviour` says; `transcode` answers with a
 * synthetic frame and a small preview, or fails. The real ffprobe and ffmpeg are exercised by the tests of `services/media-processor`; the real adapter
 * by the test of the contract with a socket server. Used only by tests and never chosen by configuration.
 */
import { Readable } from 'node:stream';
import { VideoProcessingError, type ProbeInput, type VideoDerivatives, type VideoProbe, type VideoProcessor } from './video-processor.ts';
import { syntheticWebp } from './webp.ts';

export interface RecordedVideoJob {
  readonly jobId: string;
  readonly contentType: string;
  readonly bytes: number;
}

export const SYNTHETIC_PROBE: VideoProbe = { durationSeconds: 242.4, width: 1920, height: 1080, videoCodec: 'h264', hasAudio: true };

export class FakeVideoProcessor implements VideoProcessor {
  /** What the next probes do: the probe, a fixed failure, or a function (which may hang to simulate a stuck job). */
  probeBehaviour: VideoProbe | VideoProcessingError | ((job: RecordedVideoJob) => Promise<VideoProbe>) = SYNTHETIC_PROBE;
  transcodeBehaviour: 'ok' | VideoProcessingError | ((jobId: string) => Promise<VideoDerivatives>) = 'ok';
  /** The bytes of the preview that `openPreview` streams. */
  previewBody: Buffer = Buffer.from('synthetic preview of a film');
  roomLeft = true;
  readonly jobs: RecordedVideoJob[] = [];
  readonly probed: string[] = [];
  readonly disposed: string[] = [];
  cleanups = 0;
  /** The number of calls that run at the same moment now and at most (the proof of the concurrency of ONE). */
  running = 0;
  maxRunning = 0;

  async probe(input: ProbeInput): Promise<VideoProbe> {
    this.#enter();
    try {
      let bytes = 0;
      for await (const chunk of input.original) bytes += (chunk as Uint8Array).length;
      const job: RecordedVideoJob = { jobId: input.jobId, contentType: input.contentType, bytes };
      this.jobs.push(job);
      this.probed.push(input.jobId);
      input.beforeProcessing();
      if (this.probeBehaviour instanceof VideoProcessingError) throw this.probeBehaviour;
      if (typeof this.probeBehaviour === 'function') return await this.probeBehaviour(job);
      return this.probeBehaviour;
    } finally {
      this.running -= 1;
    }
  }

  async transcode(jobId: string): Promise<VideoDerivatives> {
    this.#enter();
    try {
      if (this.transcodeBehaviour instanceof VideoProcessingError) throw this.transcodeBehaviour;
      if (typeof this.transcodeBehaviour === 'function') return await this.transcodeBehaviour(jobId);
      await Promise.resolve();
      return {
        frame: { body: syntheticWebp(320, 180), width: 320, height: 180 },
        preview: { sizeBytes: this.previewBody.length, width: 1280, height: 720 },
      };
    } finally {
      this.running -= 1;
    }
  }

  openPreview(): Promise<Readable> {
    return Promise.resolve(Readable.from([this.previewBody]));
  }

  hasRoomFor(): Promise<boolean> {
    return Promise.resolve(this.roomLeft);
  }

  dispose(jobId: string): Promise<void> {
    this.disposed.push(jobId);
    return Promise.resolve();
  }

  cleanup(): Promise<void> {
    this.cleanups += 1;
    return Promise.resolve();
  }

  #enter(): void {
    this.running += 1;
    this.maxRunning = Math.max(this.maxRunning, this.running);
  }
}
