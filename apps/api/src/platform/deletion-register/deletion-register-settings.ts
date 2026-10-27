/**
 * The settings of the register of deletions (EVM-040 AC3; SR-CRYPTO-04, ASVS V13.3.1): five variables that work ALL OR NOTHING.
 * - none set: the register is not configured (a staging without the bucket of EVM-084) - a warning at start, the service is healthy;
 * - some set: an incomplete set - an error at start naming the KEYS that are missing or malformed (never a value), the service is healthy;
 * - all set and well formed: the register is configured.
 * There is NO fail-fast on purpose: a missing or wrong setting of an optional register must never stop a deployment; the erasing operations
 * are what fails closed (`503 deletion_register_unavailable`). The secret may come from `<KEY>_FILE` like the other secrets (`config.ts`).
 */

export const DELETION_REGISTER_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'DELETION_REGISTER_BUCKET',
  'DELETION_REGISTER_S3_ACCESS_KEY_ID',
  'DELETION_REGISTER_S3_SECRET_ACCESS_KEY',
] as const;
export type DeletionRegisterKey = (typeof DELETION_REGISTER_KEYS)[number];

export interface ConfiguredDeletionRegister {
  readonly status: 'configured';
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export type DeletionRegisterSettings =
  | ConfiguredDeletionRegister
  | { readonly status: 'unconfigured' }
  | { readonly status: 'incomplete'; readonly missing: readonly DeletionRegisterKey[]; readonly invalid: readonly DeletionRegisterKey[] };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https always; http only for the loopback of a machine, and only when the caller allows it - never in production (tests and a local server of the developer). */
function validEndpoint(value: string, allowLoopbackHttp: boolean): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && allowLoopbackHttp && LOOPBACK_HOSTS.has(url.hostname);
}

const SHAPES: Record<Exclude<DeletionRegisterKey, 'S3_ENDPOINT'>, RegExp> = {
  S3_REGION: /^[a-z0-9-]{2,32}$/,
  DELETION_REGISTER_BUCKET: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
  DELETION_REGISTER_S3_ACCESS_KEY_ID: /^[\x21-\x7e]{1,128}$/,
  DELETION_REGISTER_S3_SECRET_ACCESS_KEY: /^[\x21-\x7e]{8,256}$/,
};

export function resolveDeletionRegisterSettings(
  env: Readonly<Partial<Record<DeletionRegisterKey, string | undefined>>>,
  allowLoopbackHttp: boolean,
): DeletionRegisterSettings {
  const present = (key: DeletionRegisterKey): string | undefined => {
    const value = env[key];
    return value === undefined || value === '' ? undefined : value;
  };
  const missing = DELETION_REGISTER_KEYS.filter((key) => present(key) === undefined);
  if (missing.length === DELETION_REGISTER_KEYS.length) return { status: 'unconfigured' };
  const invalid = DELETION_REGISTER_KEYS.filter((key) => {
    const value = present(key);
    if (value === undefined) return false;
    return key === 'S3_ENDPOINT' ? !validEndpoint(value, allowLoopbackHttp) : !SHAPES[key].test(value);
  });
  if (missing.length > 0 || invalid.length > 0) return { status: 'incomplete', missing, invalid };
  return {
    status: 'configured',
    endpoint: present('S3_ENDPOINT') as string,
    region: present('S3_REGION') as string,
    bucket: present('DELETION_REGISTER_BUCKET') as string,
    accessKeyId: present('DELETION_REGISTER_S3_ACCESS_KEY_ID') as string,
    secretAccessKey: present('DELETION_REGISTER_S3_SECRET_ACCESS_KEY') as string,
  };
}
