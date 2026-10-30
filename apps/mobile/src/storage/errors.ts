/**
 * Errors of the local store (EVM-093; SR-LOG-08, CWE-209/532). Errors of expo-sqlite, expo-secure-store and the file system can carry the
 * name of a key, SQL text or a path, so they never leave this module: they are mapped to a fixed code and the original is dropped.
 */
export type StorageErrorCode =
  | 'not_a_database'
  | 'disk_full'
  | 'busy'
  | 'sql_failed'
  | 'closed'
  | 'key_unavailable'
  | 'csprng_unavailable'
  | 'cipher_unsupported'
  | 'cipher_misconfigured'
  | 'file_unavailable'
  | 'locked';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode) {
    super(code);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Text of a native SQLite error mapped to a code; the text itself is never kept. */
export function classifySqlError(error: unknown): StorageErrorCode {
  if (error instanceof StorageError) return error.code;
  // duck typing, not `instanceof Error`: native errors may come from another realm (JSI bridge, node:sqlite under Jest)
  const fields = typeof error === 'object' && error !== null ? (error as { message?: unknown; code?: unknown }) : {};
  const text = `${typeof fields.message === 'string' ? fields.message : ''} ${typeof fields.code === 'string' ? fields.code : ''}`;
  if (/not a database|SQLITE_NOTADB|file is encrypted|malformed|SQLITE_CORRUPT/i.test(text)) return 'not_a_database';
  if (/disk is full|SQLITE_FULL|ENOSPC/i.test(text)) return 'disk_full';
  if (/database is locked|SQLITE_BUSY/i.test(text)) return 'busy';
  return 'sql_failed';
}

export const toStorageError = (error: unknown): StorageError =>
  error instanceof StorageError ? error : new StorageError(classifySqlError(error));
