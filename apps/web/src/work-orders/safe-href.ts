/**
 * Which addresses from DATA may become links (EVM-018 AC4; SR-WEB-03, ASVS V3.2.2, CWE-79). The notes of a site and the
 * contact data of a customer come from people, so a link is made only for `https:`, `tel:` and `mailto:` — `javascript:`,
 * `data:`, `vbscript:`, `http:` and everything else stay plain text. The address is parsed by the browser's own `URL`
 * parser (the same one that would follow it), and anything that parser could read differently from a check by eye is
 * refused before it: whitespace and control characters anywhere (`java\tscript:` is `javascript:` for a browser), an
 * `https:` address without `//` and one with a name or password in it (a lookalike of another site). `mailto:` and `tel:`
 * keep only the address / number: a query (`?cc=`, `?bcc=`, `?body=`) is dropped, so a note cannot add recipients.
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['https:', 'tel:', 'mailto:']);

/** Control (C0, C1, DEL), format (zero-width, bidi, BOM) and separator characters (space, no-break space, line and paragraph separators). */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Z}]/u;

/** @returns the address to put in `href`, or `undefined` when the text must not be a link */
export function safeHref(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > 2048 || FORBIDDEN.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return undefined;
  if (url.protocol === 'https:') {
    if (!/^https:\/\//i.test(raw) || url.username !== '' || url.password !== '' || url.hostname === '') return undefined;
    return url.href;
  }
  // tel: and mailto: carry the number or the address in the path; the query and the fragment are not kept.
  return url.pathname === '' ? undefined : `${url.protocol}${url.pathname}`;
}

/** `tel:` of a telephone number from the API (E.164): built from the encoded value, `+` kept, nothing else can be added. */
export function telHref(phone: string): string | undefined {
  return safeHref(`tel:${encodeURIComponent(phone).replaceAll('%2B', '+')}`);
}

/** `mailto:` of an e-mail address from the API: built from the encoded value, so `?cc=` in the data is part of the address, not a header. */
export function mailtoHref(email: string): string | undefined {
  return safeHref(`mailto:${encodeURIComponent(email)}`);
}
