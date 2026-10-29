/**
 * The adapter of the image processor over a Unix socket and a shared work area (EVM-068 AC3, AC5; ADR-0009; SR-FILE-04, SR-FILE-06, SR-INPUT-04;
 * TM-35, TM-36). The worker and the processor share ONE tmpfs directory (photos never reach the disk of the host — P3) and the socket in it:
 * - the directory of a job is `<workdir>/<jobId>` with a UUID chosen by the server; the input is `input`, the outputs are `<variant>.webp` — the
 *   request carries no path at all, only the job id and the type, in ONE line of JSON (the processor has its own copy of the protocol: the two
 *   sides share no code, and the test of the contract keeps them equal);
 * - the answer is NOT trusted: at most 4 KB, exactly the shape of the protocol, a fixed code or the dimensions within the edge of each variant;
 * - the outputs are NOT trusted either (a compromised processor could plant a link to a secret of the worker and have it published as a thumbnail
 *   visible to every user): each is read only under its fixed name, by `lstat` (a plain file, ONE name, no link) and `O_NOFOLLOW`, compared with
 *   what was opened, limited to 2 MB, and must be a RIFF/WEBP container whose header says the size the answer claims. Only then `putObject`;
 * - the connection and the whole exchange have a timeout (the hung socket of a dead processor is an `unavailable`, never a worker that waits forever);
 * - the work area of a job is removed in `finally`, and `cleanup()` at the start removes what a crash left.
 * Nothing here logs: the caller logs a job id and a code.
 */
import { createConnection } from 'node:net';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
  DERIVATIVE_VARIANTS,
  ImageProcessingError,
  MAX_DERIVATIVE_BYTES,
  VARIANT_EDGES,
  type DerivedImage,
  type DeriveInput,
  type DerivativeVariant,
  type ImageProcessingErrorCode,
  type ImageProcessor,
} from './image-processor.ts';
import { readWebpHeader } from './webp.ts';

export interface UnixSocketProcessorSettings {
  readonly socketPath: string;
  readonly workDir: string;
  /** Overrides of the defaults (tests only). */
  readonly timeouts?: { readonly connectMs: number; readonly exchangeMs: number };
}

/** The processor kills a job after 60 s; the worker waits a little longer (the answer, the socket) and then gives up. */
export const DEFAULT_TIMEOUTS = { connectMs: 5000, exchangeMs: 75_000 } as const;
const MAX_RESPONSE_BYTES = 4096;
/** The codes the processor may report. Anything else is `internal`: an unknown code is a processor that does not follow the protocol. */
const REPORTED_CODES: readonly ImageProcessingErrorCode[] = ['pixel_limit', 'unsupported', 'timeout', 'internal'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

interface ClaimedOutput {
  readonly variant: DerivativeVariant;
  readonly width: number;
  readonly height: number;
}

/** The answer of the processor as the worker reads it: the claimed dimensions per variant, or the fixed code of a failure. */
function parseAnswer(line: string): { outputs: ClaimedOutput[] } | { code: ImageProcessingErrorCode } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { code: 'unavailable' };
  }
  if (!isRecord(value)) return { code: 'unavailable' };
  if (value['ok'] === false) {
    const code = value['code'];
    if (!hasOnly(value, ['ok', 'code']) || typeof code !== 'string') return { code: 'internal' };
    return { code: (REPORTED_CODES as readonly string[]).includes(code) ? (code as ImageProcessingErrorCode) : 'internal' };
  }
  const outputs = value['outputs'];
  if (value['ok'] !== true || !hasOnly(value, ['ok', 'outputs']) || !Array.isArray(outputs)) return { code: 'internal' };
  if (outputs.length !== DERIVATIVE_VARIANTS.length) return { code: 'invalid_output' };
  const claimed: ClaimedOutput[] = [];
  for (const item of outputs as unknown[]) {
    if (!isRecord(item) || !hasOnly(item, ['variant', 'width', 'height'])) return { code: 'invalid_output' };
    const { variant, width, height } = item;
    if (typeof variant !== 'string' || !DERIVATIVE_VARIANTS.includes(variant as DerivativeVariant)) return { code: 'invalid_output' };
    const edge = VARIANT_EDGES[variant as DerivativeVariant];
    if (!Number.isInteger(width) || !Number.isInteger(height)) return { code: 'invalid_output' };
    if ((width as number) < 1 || (width as number) > edge || (height as number) < 1 || (height as number) > edge) {
      return { code: 'invalid_output' };
    }
    claimed.push({ variant: variant as DerivativeVariant, width: width as number, height: height as number });
  }
  return new Set(claimed.map((item) => item.variant)).size === DERIVATIVE_VARIANTS.length
    ? { outputs: claimed }
    : { code: 'invalid_output' };
}

/** What `beforeProcessing` threw: it is the verdict of the caller and goes back to it unchanged. */
class CallerVerdict extends Error {
  readonly verdict: unknown;
  constructor(verdict: unknown) {
    super('caller verdict');
    this.verdict = verdict;
  }
}

/** Counts the bytes of the original and refuses a stream longer than its recorded size (a damaged or swapped object). */
function capped(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) callback(new ImageProcessingError('unsupported'));
      else callback(null, chunk);
    },
  });
}

export class UnixSocketImageProcessor implements ImageProcessor {
  readonly #settings: UnixSocketProcessorSettings;

  constructor(settings: UnixSocketProcessorSettings) {
    this.#settings = settings;
  }

  async derive(input: DeriveInput): Promise<readonly DerivedImage[]> {
    const dir = join(this.#settings.workDir, input.jobId);
    try {
      await mkdir(dir, { mode: 0o770 });
      try {
        await pipeline(input.original, capped(input.maxBytes), createWriteStream(join(dir, 'input'), { flags: 'wx', mode: 0o640 }));
      } catch (error) {
        if (error instanceof ImageProcessingError) throw error;
        throw new ImageProcessingError('internal');
      }
      try {
        input.beforeProcessing();
      } catch (error) {
        throw new CallerVerdict(error);
      }
      const answer = await this.#ask(JSON.stringify({ jobId: input.jobId, contentType: input.contentType }));
      if ('code' in answer) throw new ImageProcessingError(answer.code);
      const images: DerivedImage[] = [];
      for (const claimed of answer.outputs) images.push(await this.#readOutput(dir, claimed));
      return images;
    } catch (error) {
      if (error instanceof CallerVerdict) throw error.verdict as Error;
      // a fault of the work area (the directory exists, the volume is full or gone) is the fault of the system, never a message with a path
      throw error instanceof ImageProcessingError ? error : new ImageProcessingError('internal');
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cleanup(): Promise<void> {
    for (const entry of await readdir(this.#settings.workDir).catch(() => [])) {
      // the socket of the processor lives in the same area: only job directories (UUID names) are removed
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry)) {
        await rm(join(this.#settings.workDir, entry), { recursive: true, force: true });
      }
    }
  }

  /** One line out, one line in (at most 4 KB); every failure of the transport is `unavailable`. */
  #ask(request: string): Promise<{ outputs: ClaimedOutput[] } | { code: ImageProcessingErrorCode }> {
    const { connectMs, exchangeMs } = this.#settings.timeouts ?? DEFAULT_TIMEOUTS;
    return new Promise((resolve) => {
      const socket = createConnection(this.#settings.socketPath);
      let received = '';
      let settled = false;
      const finish = (value: { outputs: ClaimedOutput[] } | { code: ImageProcessingErrorCode }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(exchangeTimer);
        socket.destroy();
        resolve(value);
      };
      const connectTimer = setTimeout(() => {
        finish({ code: 'unavailable' });
      }, connectMs);
      const exchangeTimer = setTimeout(() => {
        finish({ code: 'unavailable' });
      }, exchangeMs);
      socket.on('connect', () => {
        clearTimeout(connectTimer);
        socket.write(`${request}\n`);
      });
      socket.on('error', () => {
        finish({ code: 'unavailable' });
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('utf8');
        if (received.length > MAX_RESPONSE_BYTES) finish({ code: 'internal' });
      });
      socket.on('close', () => {
        const end = received.indexOf('\n');
        finish(end === -1 ? { code: 'unavailable' } : parseAnswer(received.slice(0, end)));
      });
    });
  }

  /** Reads one output: a plain file with one name, opened without following a link, within the size limit, a WebP of the claimed size. */
  async #readOutput(dir: string, claimed: ClaimedOutput): Promise<DerivedImage> {
    const path = join(dir, `${claimed.variant}.webp`);
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > MAX_DERIVATIVE_BYTES) {
        throw new ImageProcessingError('invalid_output');
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.size !== before.size
        ) {
          throw new ImageProcessingError('invalid_output');
        }
        const body = Buffer.alloc(opened.size);
        const { bytesRead } = await handle.read(body, 0, opened.size, 0);
        if (bytesRead !== opened.size) throw new ImageProcessingError('invalid_output');
        const header = readWebpHeader(body);
        if (header?.width !== claimed.width || header.height !== claimed.height) throw new ImageProcessingError('invalid_output');
        return { variant: claimed.variant, body, width: header.width, height: header.height };
      } finally {
        await handle.close();
      }
    } catch (error) {
      // a missing file, a link (ELOOP) or any other fault of the file system is a bad output, never a path in a message
      throw error instanceof ImageProcessingError ? error : new ImageProcessingError('invalid_output');
    }
  }
}
