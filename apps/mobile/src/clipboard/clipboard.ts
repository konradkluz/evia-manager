/**
 * The sensitive clipboard of the app (EVM-107 AC4; MASVS-PLATFORM-3, CWE-200): "Kopiuj treść" of a rejected entry. The only way to
 * the system clipboard is the local Kotlin module `evia-clipboard`: it marks the copy `EXTRA_IS_SENSITIVE` and removes it after 60 s
 * with a native timer (timers of JavaScript stop in the background). Without the module nothing is copied - the plain clipboard of
 * React Native or Expo would leave personal data of customers in the system without the mark and without the removal.
 * The text goes through this port and is neither logged nor kept.
 */
import { requireOptionalNativeModule } from 'expo';

export const SENSITIVE_CLIPBOARD_TTL_MS = 60_000;

interface ClipboardNative {
  copySensitive(text: string, ttlMs: number): boolean;
  clearOwn(): void;
}

export interface SensitiveClipboard {
  /** `true` when the text was put on the clipboard (marked, with the removal scheduled). */
  copy(text: string): boolean;
  /** Removes the app's own copy now (sign-out, end of session, wipe, hidden-data mode, lock); idempotent, never throws. */
  clear(): void;
}

const load = (): ClipboardNative | null => requireOptionalNativeModule<ClipboardNative>('EviaClipboard');

export function createSensitiveClipboard(native: ClipboardNative | null = load()): SensitiveClipboard {
  return {
    copy(text) {
      if (native === null || text === '') return false;
      try {
        return native.copySensitive(text, SENSITIVE_CLIPBOARD_TTL_MS);
      } catch {
        return false;
      }
    },
    clear() {
      try {
        native?.clearOwn();
      } catch {
        // the clipboard is cleared on a best-effort basis; nothing to report
      }
    },
  };
}
