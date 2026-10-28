/**
 * The S3 adapter of the register of deletions (EVM-040 AC3; SR-PRIV-04, SR-CRYPTO-04, SR-SUPPLY-06; ASVS V12.3.1, V13.3.x). The ONLY file (with
 * the object storage of EVM-044) that imports the SDK (`.dependency-cruiser.cjs`). Rules:
 * - a SEPARATE client with its OWN key that can only `PutObject`: credentials are passed explicitly, so the default chain of the SDK
 *   (`AWS_*` variables, `~/.aws`, the metadata service) is never consulted;
 * - ONE command in the whole file, `PutObjectCommand`: no read, list, head or delete - the bucket grants nothing else and the code does not ask;
 * - path-style addressing, `requestChecksumCalculation: 'WHEN_REQUIRED'` (a provider other than AWS does not accept the newer checksums), the
 *   key of the object is new for every record (versioning of the bucket guards an overwrite, not a condition on the request), `Content-Type:
 *   application/json`, no metadata headers, no ACL;
 * - bounded: two attempts, timeouts of the connection and of the request, and a total deadline of about five seconds for the whole record;
 * - every failure is a {@link DeletionRegisterUnavailable} with a fixed reason; the answer of the storage and the error object are never logged
 *   (only the class name of the error), the SDK logger is silent.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Clock } from '../clock/clock.ts';
import type { Logger } from '../logging/logger.ts';
import type { Counter } from '../metrics/metrics.ts';
import { DeletionRegisterUnavailable, type DeletionReceipt, type DeletionRecord, type DeletionRegister } from './deletion-register.ts';
import type { ConfiguredDeletionRegister } from './deletion-register-settings.ts';
import { registerObjectOf } from './register-object.ts';

export const REGISTER_DEADLINE_MS = 5000;
const CONNECTION_TIMEOUT_MS = 2000;
const REQUEST_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 2;

const SILENT_SDK_LOGGER = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/** The client is a separate instance with explicit credentials; nothing is read from the environment. */
export function registerClient(settings: ConfiguredDeletionRegister): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: MAX_ATTEMPTS,
    requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
    logger: SILENT_SDK_LOGGER,
  });
}

export class S3DeletionRegister implements DeletionRegister {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #failures: Counter;
  readonly #deadlineMs: number;

  constructor(
    settings: ConfiguredDeletionRegister,
    clock: Clock,
    logger: Logger,
    failures: Counter,
    deadlineMs: number = REGISTER_DEADLINE_MS,
  ) {
    this.#client = registerClient(settings);
    this.#bucket = settings.bucket;
    this.#clock = clock;
    this.#logger = logger;
    this.#failures = failures;
    this.#deadlineMs = deadlineMs;
  }

  async record(record: DeletionRecord): Promise<DeletionReceipt> {
    const object = registerObjectOf(record, this.#clock.now());
    try {
      await this.#client.send(
        new PutObjectCommand({ Bucket: this.#bucket, Key: object.key, Body: object.body, ContentType: 'application/json' }),
        { abortSignal: AbortSignal.timeout(this.#deadlineMs) },
      );
    } catch (error) {
      this.#failures.increment({ reason: 'write_failed' });
      // the class of the error only: the message and the response of the storage are not ours to write to a log
      this.#logger.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'deletion register write failed');
      throw new DeletionRegisterUnavailable('write_failed');
    }
    return { operationId: object.operationId, key: object.key };
  }
}
