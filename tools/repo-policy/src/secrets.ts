/**
 * Secret-related configuration (EVM-006 AC5; SR-INFRA-05; security-engineer A3).
 */

/** Typical secret shapes — never allowed as a value in .env.example (assembled from fragments: no literal here). */
const SECRET_SHAPES = [
  new RegExp(['gh', '[pousr]_[0-9A-Za-z]{20,}'].join('')),
  new RegExp(['github', '_pat_'].join('')),
  new RegExp(['AK', 'IA[0-9A-Z]{16}'].join('')),
  new RegExp(['-----BEGIN', '[A-Z ]*PRIVATE KEY'].join(' ?')),
  new RegExp(['xox', '[baprs]-'].join('')),
  new RegExp(['sk', '_live_'].join('')),
];

/** .env.example: names and example values only. */
export function envExampleProblems(content: string): string[] {
  return content.split('\n').flatMap((line, index) => {
    const where = `.env.example: linia ${index + 1}`;
    if (SECRET_SHAPES.some((shape) => shape.test(line))) return [`${where}: wartość o wzorcu sekretu`];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return [];
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) return [`${where}: oczekiwano NAZWA=wartość-przykładowa`];
    const value = match[2] ?? '';
    return /^[A-Za-z0-9+/=_-]{32,}$/.test(value) ? [`${where}: długa wartość przypominająca sekret — użyj wartości przykładowej`] : [];
  });
}

/** A3: .gitleaks.toml extends the default rules and nothing else (no allowlists of paths, regexes or commits). */
export function gitleaksConfigProblems(content: string): string[] {
  const meaningful = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  return JSON.stringify(meaningful) === JSON.stringify(['[extend]', 'useDefault = true'])
    ? []
    : ['.gitleaks.toml: dozwolone wyłącznie [extend] useDefault = true (bez allowlist paths, regexes, commits)'];
}
