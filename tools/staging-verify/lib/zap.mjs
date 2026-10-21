// @ts-check
/**
 * The anonymous ZAP baseline (EVM-007 AC6; Konrad's decision 2026-10-13, bramki 7–8: in CI only the anonymous
 * baseline; security-engineer B): High and Medium alerts outside the exceptions are red. Exceptions live in
 * infra/zap/rules.tsv — `<pluginId>\t<expires YYYY-MM-DD>\t<reason>` — every one with a reason and an expiry date;
 * an expired exception is red (it must be reviewed, not silently kept).
 */

/** @typedef {{ pluginId: string, expires: string, reason: string }} Exception */

/** @param {string} text @returns {{ exceptions: Exception[], problems: string[] }} */
export function parseRules(text) {
  const exceptions = [];
  const problems = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const [pluginId = '', expires = '', reason = '', ...rest] = line.split('\t');
    if (!/^\d{1,6}$/.test(pluginId) || !/^\d{4}-\d{2}-\d{2}$/.test(expires) || reason.trim().length < 10 || rest.length > 0)
      problems.push(`rules.tsv:${String(index + 1)}: wymagane <pluginId>\\t<YYYY-MM-DD>\\t<powód (≥ 10 znaków)>`);
    else exceptions.push({ pluginId, expires, reason });
  }
  return { exceptions, problems };
}

/**
 * @param {unknown} report the JSON report of zap-baseline.py (-J)
 * @param {string} rulesText
 * @param {string} today YYYY-MM-DD (Europe/Warsaw)
 * @returns {import('./checks.mjs').Check}
 */
export function evaluateZap(report, rulesText, today) {
  const { exceptions, problems } = parseRules(rulesText);
  const details = [...problems];
  for (const exception of exceptions)
    if (exception.expires < today) details.push(`wyjątek ${exception.pluginId} wygasł ${exception.expires} — przegląd`);
  const sites =
    /** @type {{ site?: Array<{ alerts?: Array<{ pluginid?: string, riskcode?: string, name?: string, count?: string }> }> }} */ (report);
  if (typeof report !== 'object' || report === null || !Array.isArray(sites.site) || sites.site.length === 0)
    return { id: 'zap', passed: false, details: [...details, 'raport ZAP bez witryny (skan nie przeszedł)'] };
  let count = 0;
  for (const site of sites.site)
    for (const alert of site.alerts ?? []) {
      const risk = Number(alert.riskcode);
      if (risk < 2) continue;
      if (exceptions.some((exception) => exception.pluginId === alert.pluginid && exception.expires >= today)) continue;
      count += 1;
      details.push(`${risk === 3 ? 'High' : 'Medium'}: ${String(alert.pluginid)} ${String(alert.name)} (${alert.count ?? '?'})`);
    }
  return {
    id: 'zap',
    passed: details.length === 0,
    details: details.length === 0 ? ['brak ustaleń High/Medium spoza wyjątków'] : [`${String(count)} ustaleń`, ...details],
  };
}
