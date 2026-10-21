/**
 * Plain-text names of the account (EVM-028 AC1, AC3; SR-INPUT-05): the display name (≤ 200) and the name of a passkey (≤ 60). The panel
 * checks what the server checks (NFC, trimmed, no control or formatting characters, so no line breaks and no bidi marks) to save a
 * round trip; the server decides all the same. Names are rendered as text, never as HTML.
 */
export const MAX_DISPLAY_NAME = 200;
export const MAX_PASSKEY_NAME = 60;

/** Control (Cc), format (Cf) and line / paragraph separator (Zl, Zp) characters: the same class the server refuses. */
const NOT_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type NameProblem = 'required' | 'too_long' | 'invalid_characters';

/** The normalised name (NFC, trimmed) the panel sends. */
export const normaliseName = (raw: string): string => raw.normalize('NFC').trim();

/** `null` when the name is acceptable; the length counts Unicode code points like the server. */
export function nameProblem(raw: string, max: number, { optional = false }: { readonly optional?: boolean } = {}): NameProblem | null {
  const value = normaliseName(raw);
  if (value === '') return optional ? null : 'required';
  if (Array.from(value).length > max) return 'too_long';
  return NOT_TEXT.test(value) ? 'invalid_characters' : null;
}

/** The problem the server reported for a field (`/displayName`, `/name`), if it is one of the known codes. */
export function serverNameProblem(
  errors: readonly { readonly pointer: string; readonly code: string }[],
  pointer: string,
): NameProblem | null {
  const found = errors.find((entry) => entry.pointer === pointer);
  return found?.code === 'required' || found?.code === 'too_long' || found?.code === 'invalid_characters' ? found.code : null;
}
