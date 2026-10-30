/**
 * Native surfaces of the local store (EVM-093), each behind a thin port so the opening and wipe machines are tested in Jest
 * (ADR-0015). Production implementations: `platform.ts` (expo-secure-store, expo-file-system, expo-crypto, evia-keystore module)
 * and `expo-sqlite-driver.ts`.
 */

/** Result of reading the database key. `unavailable` = any error (Keystore busy, I/O, unknown): retried, never a reason to delete. */
export type KeyRead = { readonly kind: 'present'; readonly hex: string } | { readonly kind: 'absent' } | { readonly kind: 'unavailable' };

export type KeyHardware = 'secure_hardware' | 'software' | 'unknown';

/** The 256-bit database key, wrapped by a non-exportable AES-GCM key of the Android Keystore (expo-secure-store, own service). */
export interface KeyVault {
  read(): Promise<KeyRead>;
  write(hex: string): Promise<void>;
  /** Crypto-shred: removes the wrapped copy AND the Keystore alias of its service. Idempotent; a failure rejects. */
  destroy(): Promise<void>;
  /** Diagnostic fact only (`isInsideSecureHardware` / StrongBox); never blocks anything. */
  hardware(): Promise<KeyHardware>;
}

/** Small files of the app outside the database (wipe marker, key check value) in the internal documents directory (no backup). */
export interface AppFiles {
  /** `null` when the file does not exist; rejects on an I/O error. */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  /** Idempotent. */
  remove(name: string): Promise<void>;
}

/** CSPRNG and digest (expo-crypto). There is no fallback: without a CSPRNG there is no database (never `Math.random`). */
export interface CryptoSource {
  getRandomBytes(length: number): Uint8Array;
  sha256Hex(text: string): Promise<string>;
}

/** Installation identity of the device (`deviceId` + secret from the device registration, EVM-100); absent = a new device. */
export interface InstallationIdentity {
  readonly deviceId: string;
  readonly secret: string;
}

/** Other secrets of the app (expo-secure-store) and the steps of the wipe that are not the database. */
export interface DeviceSecrets {
  readIdentity(): Promise<InstallationIdentity | null>;
  writeIdentity(identity: InstallationIdentity): Promise<void>;
  deleteIdentity(): Promise<void>;
  /** Sign-out and `session_revoked`: ONLY the refresh token (the queue and its key stay, AC7). */
  deleteRefreshToken(): Promise<void>;
  /** Every remaining secure-store entry (wipe only, AC6). */
  deleteAllSecrets(): Promise<void>;
  /** Preferences of the app (wipe only). */
  deletePreferences(): Promise<void>;
  /** Cached crash reports (wipe only). */
  deleteCrashReports(): Promise<void>;
}

export type StorageDiagnostic =
  | { readonly event: 'db-open-failed'; readonly code: string }
  | { readonly event: 'keystore-hardware'; readonly level: KeyHardware }
  | { readonly event: 'wipe-step-failed'; readonly step: string };
