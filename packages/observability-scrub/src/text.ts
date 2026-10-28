// Text and URL redaction for error-tracking payloads (EVM-085 AC6, AC7; SR-LOG-02, SR-PRIV-09).
// Second line of defence: the first is that tokens never travel in URLs (the activation token is in a POST body and in the
// fragment of the web link). Every pattern is linear (no nested quantifiers) so a hostile message cannot cause ReDoS.

export const REDACTED = 'REDACTED';

const ACTIVATION_PATH = /\/api\/v1\/auth\/activation\/[^\s"'<>?#]*/gu;
const QUERY_AFTER_PATH = /(?<=[\w/.-])\?[^\s"'<>]+/gu;
const FRAGMENT_AFTER_PATH = /(?<=[\w/.-])#[^\s"'<>]*/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/gu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const GITHUB_TOKEN = /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/gu;
const AMZ_PARAM = /X-Amz-(?:Signature|Credential|Security-Token)=[^&\s"'<>]*/giu;
// 32 random bytes in base64url (the activation and reset token format): exactly 43 characters of the URL-safe alphabet.
const TOKEN_43 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/gu;
const EMAIL = /[\p{L}\p{N}._%+-]{1,254}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** Redacts tokens, credentials, e-mail addresses, query strings and fragments from free text (messages, URLs in messages). */
export function redactText(text: string): string {
  return text
    .replace(ACTIVATION_PATH, `/api/v1/auth/activation/${REDACTED}`)
    .replace(AMZ_PARAM, `X-Amz-${REDACTED}`)
    .replace(QUERY_AFTER_PATH, '')
    .replace(FRAGMENT_AFTER_PATH, '')
    .replace(JWT, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(TOKEN_43, REDACTED)
    .replace(EMAIL, REDACTED);
}

/**
 * Reduces a URL (absolute, relative or a transaction name) to its path: no query, no fragment, the segment after
 * /api/v1/auth/activation/ replaced. Never throws; never returns more than the input contained.
 */
export function scrubUrl(url: string): string {
  const end = url.search(/[?#]/u);
  const path = end === -1 ? url : url.slice(0, end);
  return redactText(path);
}
