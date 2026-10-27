// @ts-check
/**
 * The result of staging-verify (EVM-007 AC6): a Markdown summary for the run and the `staging-verified` artifact. A
 * skipped check (the bucket until EVM-084) is shown as skipped — never as passed.
 */

/** The result word of a check: a passed check with warnings is never shown as plain OK. @param {import('./checks.mjs').Check} check */
export const label = (check) =>
  check.skipped === true ? 'pominięta' : !check.passed ? 'BŁĄD' : (check.warnings?.length ?? 0) > 0 ? 'OSTRZEŻENIE' : 'OK';

/** @param {{ commit: string, manifestSha256: string, checks: import('./checks.mjs').Check[], checkedAt: string }} input */
export function summarize({ commit, manifestSha256, checks, checkedAt }) {
  const passed = checks.length > 0 && checks.every((check) => check.passed || check.skipped === true);
  const warned = checks.some((check) => check.passed && (check.warnings?.length ?? 0) > 0);
  const lines = [
    `### staging-verify (bramka 10) — ${passed ? (warned ? 'zielony (z ostrzeżeniami)' : 'zielony') : 'CZERWONY'}`,
    '',
    `Commit \`${commit}\`, manifest \`${manifestSha256}\`, ${checkedAt}`,
    '',
    '| Kontrola | Wynik | Szczegóły |',
    '|---|---|---|',
    ...checks.map((check) => `| ${check.id} | ${label(check)} | ${check.details.join('; ').replace(/\|/g, '\\|')} |`),
  ];
  return { passed, markdown: `${lines.join('\n')}\n`, json: { schemaVersion: 1, commit, manifestSha256, checkedAt, passed, checks } };
}

/** The bucket check of AC6 joins with EVM-084, when the media bucket exists. @returns {import('./checks.mjs').Check} */
export const bucketCheck = () => ({
  id: 'bucket-403',
  passed: false,
  skipped: true,
  details: ['pominięta do EVM-084 (bucket jeszcze nie istnieje)'],
});
