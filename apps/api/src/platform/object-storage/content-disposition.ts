/**
 * The `Content-Disposition` of a signed download, built by the SERVER only (EVM-045 AC2; SR-FILE-07, SR-WEB-04; ASVS V5.4.2; CWE-113, CWE-22):
 * `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<RFC 8187 percent-encoding>`. The caller passes a name it has already cleaned
 * ({@link attachmentHeader} refuses a name with a control character, a quote, a backslash or a slash instead of repairing it - defence in
 * depth, the header never carries a line break or a path).
 */

/** What the browser is told to do with the object: show a derivative, save an original. */
export type Disposition = { readonly kind: 'inline' } | { readonly kind: 'attachment'; readonly filename: string };

const REFUSED = /[\p{Cc}"\\/]/u;
const MAX_FALLBACK = 100;
// The fallback keeps letters, digits, space and `. _ ( ) -` only: NFKD turns full-width quotes, `;` and `=` into ASCII ones that would open a parameter.

/** RFC 8187 `attr-char`: everything `encodeURIComponent` leaves except `! ' ( ) *`, which are encoded too. */
const percentEncode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** @throws RangeError when the name is empty or has a character that could break out of the header or point into a path */
export function attachmentHeader(filename: string): string {
  const name = filename.toWellFormed();
  if (name === '' || REFUSED.test(name)) throw new RangeError('unsafe download name');
  const fallback = Array.from(name.normalize('NFKD').replace(/\p{M}/gu, ''))
    .map((char) => (/^[A-Za-z0-9 ._()-]$/.test(char) ? char : '_'))
    .join('')
    .slice(0, MAX_FALLBACK);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${percentEncode(name)}`;
}

export const dispositionHeader = (disposition: Disposition): string =>
  disposition.kind === 'inline' ? 'inline' : attachmentHeader(disposition.filename);
