/**
 * Plain text at the boundary (SR-INPUT-05, ASVS V1.1.1, V2.2.1): normalised to NFC ONCE, trimmed, with no control or
 * invisible formatting characters (a new line only where the field is multi-line). The value is text and nothing else — it is
 * never interpreted as markup; the panel renders it as text (SR-WEB-03).
 */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type TextResult = { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly code: string };

export interface TextRules {
  readonly maxLength: number;
  readonly multiline?: boolean;
}

/** @returns the NFC text with line ends as `\n`; an empty value after trimming is `undefined` (absent) */
export function plainText(raw: string | undefined, { maxLength, multiline = false }: TextRules): TextResult {
  if (raw === undefined) return { ok: true, value: undefined };
  let text = raw.normalize('NFC').trim();
  if (multiline) text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (FORBIDDEN.test(multiline ? text.replaceAll('\n', '') : text)) return { ok: false, code: 'invalid_characters' };
  if (text.length > maxLength) return { ok: false, code: 'too_long' };
  return { ok: true, value: text === '' ? undefined : text };
}
