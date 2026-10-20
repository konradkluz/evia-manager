// @ts-check
/**
 * The digest of the APK for the job summary (EVM-009 AC5; security-engineer B1 d, B6): the SHA-256 of the file is public data
 * that a person compares before installing the package on a phone (docs/ops/dystrybucja-apk-android.md).
 */
import { createHash } from 'node:crypto';

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {{ name: string, sha256: string, signed: boolean, notes: string[] }} input
 * @returns {string} Markdown for $GITHUB_STEP_SUMMARY
 */
export function digestSummary({ name, sha256: digest, signed, notes }) {
  return [
    '### APK Androida',
    '',
    signed
      ? 'Status: **podpisany**'
      : 'Status: **NIEPODPISANY** — nie da się go zainstalować; podpis dodaje job `mobile-sign` na `main` (docs/ops/dystrybucja-apk-android.md).',
    '',
    `- Plik: \`${name}\``,
    `- SHA-256: \`${digest}\``,
    ...notes.map((note) => `- ${note}`),
    '',
  ].join('\n');
}
