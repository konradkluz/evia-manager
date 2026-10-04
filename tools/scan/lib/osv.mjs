// @ts-check
/**
 * Threshold of bramka 3 (OSV-Scanner) — docs/security/requirements.md, security-engineer A5:
 * blocks every malicious package (MAL-…) and every Critical/High vulnerability with an available fix; the rest is
 * reported. Fail closed: without a CVSS score and without a severity, a fixable vulnerability counts as High.
 * Exceptions (ignoreUntil) are applied by OSV-Scanner itself from osv-scanner.toml.
 */

const HIGH_SCORE = 7.0;
const HIGH_LEVELS = new Set(['CRITICAL', 'HIGH']);

/**
 * @typedef {object} OsvFinding
 * @property {string} package `name@version`
 * @property {string[]} ids group ids (GHSA, CVE, MAL …)
 * @property {string} severity CVSS score or database severity, `unknown` when missing
 * @property {boolean} fixAvailable
 * @property {boolean} malicious
 * @property {boolean} blocking
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {});
/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);
/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * @param {unknown} report parsed OSV-Scanner JSON (`scan source --format json --all-packages`)
 * @returns {{ packages: number, findings: OsvFinding[] }}
 */
export function evaluateOsv(report) {
  /** @type {OsvFinding[]} */
  const findings = [];
  let packages = 0;
  for (const result of list(record(report)['results'])) {
    for (const entry of list(record(result)['packages'])) {
      packages += 1;
      const info = record(record(entry)['package']);
      const name = text(info['name']);
      const vulnerabilities = list(record(entry)['vulnerabilities']).map(record);
      for (const group of list(record(entry)['groups']).map(record)) {
        const ids = list(group['ids']).map(text);
        const aliases = list(group['aliases']).map(text);
        const members = vulnerabilities.filter((vulnerability) => ids.includes(text(vulnerability['id'])));
        const malicious = [...ids, ...aliases].some((id) => id.startsWith('MAL-'));
        const fixAvailable = members.some((vulnerability) =>
          list(vulnerability['affected'])
            .map(record)
            .filter((affected) => text(record(affected['package'])['name']) === name)
            .some((affected) =>
              list(affected['ranges']).some((range) => list(record(range)['events']).some((event) => 'fixed' in record(event))),
            ),
        );
        const score = Number.parseFloat(text(group['max_severity']));
        const levels = members
          .map((vulnerability) => text(record(vulnerability['database_specific'])['severity']).toUpperCase())
          .filter(Boolean);
        const high = score >= HIGH_SCORE || levels.some((level) => HIGH_LEVELS.has(level)) || (Number.isNaN(score) && levels.length === 0);
        const severity = Number.isNaN(score) ? (levels[0] ?? 'unknown') : String(score);
        findings.push({
          package: `${name}@${text(info['version'])}`,
          ids,
          severity,
          fixAvailable,
          malicious,
          blocking: malicious || (fixAvailable && high),
        });
      }
    }
  }
  return { packages, findings };
}
