// @ts-check
/**
 * Look for secrets and leftovers in the CONTENTS of the built APK (EVM-009 AC6; SR-MOB-11 "skan sekretów w paczce"; MASVS-STORAGE-1):
 * files that must not be shipped, patterns of well-known credentials in the bundle and the assets, and the public build-time
 * variables of the JavaScript bundle (only EXPO_PUBLIC_API_BASE_URL is allowed). Findings carry the path and the rule — never the
 * matched text, so a report cannot leak what it found.
 */

export const ALLOWED_PUBLIC_VARIABLES = Object.freeze(['EXPO_PUBLIC_API_BASE_URL']);

/** Files that never belong in a package (keys, certificates, environment files, source maps with sources). */
const FORBIDDEN_FILE =
  /(?:\.(?:keystore|jks|p12|pfx|pem|key|crt|cer|der|map|env)|(?:^|\/)\.env[^/]*|(?:^|\/)google-services\.json|(?:^|\/)credentials[^/]*\.json)$/i;

/** High-confidence credential shapes. */
const SECRET_PATTERNS = /** @type {const} */ ([
  ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['github-token', /\bgh[pousr]_[0-9A-Za-z]{36,}\b/],
  ['slack-token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ['stripe-key', /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/],
  ['json-web-token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['credentials-in-url', /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['password-assignment', /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
]);

/**
 * @param {string[]} paths entries of the APK (`apkanalyzer files list`)
 * @returns {string[]} problems
 */
export function checkFileList(paths) {
  return paths.filter((path) => FORBIDDEN_FILE.test(path)).map((path) => `forbidden file ${path}`);
}

/**
 * @param {string} path
 * @param {string} text
 * @returns {string[]} problems: path and rule only
 */
export function scanText(path, text) {
  /** @type {string[]} */
  const problems = SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([rule]) => `${rule} in ${path}`);
  const variables = new Set(text.match(/EXPO_PUBLIC_[A-Z0-9_]+/g) ?? []);
  for (const variable of variables) {
    if (!ALLOWED_PUBLIC_VARIABLES.includes(variable)) problems.push(`public variable ${variable} in ${path}`);
  }
  return problems;
}

/**
 * Entries worth reading as text: the bundle, JSON, XML and plain text assets — not images, fonts or native libraries.
 * @param {string} path
 */
export function isScannable(path) {
  return (
    /^\/?(?:assets|res\/raw)\//.test(path) &&
    !/\.(?:png|jpe?g|webp|gif|ttf|otf|woff2?|so|dex|mp[34]|ogg|wav)$/i.test(path) &&
    !path.endsWith('/')
  );
}
