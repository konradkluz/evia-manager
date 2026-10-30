import { StorageError } from './errors';
import type { CryptoSource } from './ports';

/** The only shape a key may have before it is put into `PRAGMA key` (a PRAGMA takes no bound parameter). */
export const KEY_HEX = /^[0-9a-f]{64}$/;
export const KEY_BYTES = 32;
/** Domain label of the key check value: SHA-256 over label + key; it identifies the key, it does not reveal it. */
const KCV_LABEL = 'evia.database-key-check.v1:';

/** 256 bits from the CSPRNG as lowercase hex; the byte buffer is zeroed afterwards (best effort in JS). */
export function generateKeyHex(crypto: CryptoSource): string {
  let bytes: Uint8Array;
  try {
    bytes = crypto.getRandomBytes(KEY_BYTES);
  } catch {
    throw new StorageError('csprng_unavailable');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== KEY_BYTES || bytes.every((b) => b === 0))
    throw new StorageError('csprng_unavailable');
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  bytes.fill(0);
  return hex;
}

export function keyPragma(hex: string): string {
  if (!KEY_HEX.test(hex)) throw new StorageError('key_unavailable');
  return `PRAGMA key = "x'${hex}'"`;
}

export const keyCheckValue = (crypto: CryptoSource, hex: string): Promise<string> => crypto.sha256Hex(`${KCV_LABEL}${hex}`);

/** SQLCipher 4.6 or newer, compared numerically ("4.17.0" > "4.6"); an empty answer means plain SQLite (no cipher). */
export function cipherVersionSupported(answer: unknown): boolean {
  if (typeof answer !== 'string') return false;
  const match = /^(\d+)\.(\d+)/.exec(answer.trim());
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 4 || (major === 4 && minor >= 6);
}
