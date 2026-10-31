/**
 * The process of the media processor (EVM-068; ADR-0009): reads the socket path and the work directory from the environment (both absolute),
 * listens, and stops on SIGTERM. The socket is group-accessible (0660) so the worker, which shares the volume and the group, can connect.
 */
import { chmod, rm } from 'node:fs/promises';
import type { Server } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { runJob } from './run-job.ts';
import { defaultTools, probeVideo, transcodeVideo, type VideoTools } from './run-video.ts';
import { createProcessorServer, type JobLogger, type JobRunner } from './server.ts';

export interface ProcessorSettings {
  readonly socketPath: string;
  readonly workDir: string;
  /** The work area of VIDEOS: a separate disk volume (noexec, nosuid, nodev); without it a video job is refused (EVM-046). */
  readonly videoWorkDir?: string;
}

/** @returns the settings, or `undefined` when a path is missing or not absolute */
export function settingsOf(env: Readonly<Record<string, string | undefined>>): ProcessorSettings | undefined {
  const socketPath = env['MEDIA_PROCESSOR_SOCKET'];
  const workDir = env['MEDIA_PROCESSOR_WORKDIR'];
  const videoWorkDir = env['MEDIA_PROCESSOR_VIDEO_WORKDIR'];
  if (videoWorkDir !== undefined && !isAbsolute(videoWorkDir)) return undefined;
  return socketPath !== undefined && workDir !== undefined && isAbsolute(socketPath) && isAbsolute(workDir)
    ? { socketPath, workDir, ...(videoWorkDir === undefined ? {} : { videoWorkDir }) }
    : undefined;
}

/** The runner of the listener: photos in a child process, videos through ffprobe and ffmpeg in the work area of videos (a request carries no path). */
export function createRunner(settings: ProcessorSettings, timeoutMs?: number, tools: VideoTools = defaultTools()): JobRunner {
  return (request) => {
    if (!('step' in request)) return runJob(request, { workDir: settings.workDir, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    if (settings.videoWorkDir === undefined) return Promise.resolve({ ok: false, code: 'internal' });
    const dir = join(settings.videoWorkDir, request.jobId);
    return request.step === 'probe' ? probeVideo(dir, tools) : transcodeVideo(dir, tools);
  };
}

/** Starts the listener; the promise settles once the socket accepts connections. */
export async function startProcessor(settings: ProcessorSettings, log: JobLogger, timeoutMs?: number, tools?: VideoTools): Promise<Server> {
  const server = createProcessorServer(createRunner(settings, timeoutMs, tools), log);
  await rm(settings.socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.socketPath, resolve);
  });
  await chmod(settings.socketPath, 0o660);
  log({ event: 'listening' });
  return server;
}

/* v8 ignore start -- process wiring of the container (settingsOf() and startProcessor() are tested; the container in the IaC session) */
if (import.meta.main) {
  const settings = settingsOf(process.env);
  if (settings === undefined) {
    process.stderr.write(
      'media-processor: MEDIA_PROCESSOR_SOCKET and MEDIA_PROCESSOR_WORKDIR (and MEDIA_PROCESSOR_VIDEO_WORKDIR when set) must be absolute paths\n',
    );
    process.exit(1);
  }
  const server = await startProcessor(settings, (entry) => {
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), service: 'media-processor', ...entry })}\n`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
/* v8 ignore stop */
