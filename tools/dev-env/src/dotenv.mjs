// @ts-check
/**
 * Minimal `.env` reader (EVM-077): `NAME=value` lines, `#` comments, optional surrounding quotes, no expansion and no
 * command substitution. Returns only valid names; values are never logged by the callers.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseDotenv(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match === null) continue;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[/** @type {string} */ (match[1])] = value;
  }
  return values;
}
