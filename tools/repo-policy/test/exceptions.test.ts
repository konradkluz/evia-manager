/**
 * Scanner exceptions on the real repository (EVM-006 AC4; requirements.md → "Obsługa wyjątków"; security-engineer
 * B2, A5; architect W7). An expired or undocumented exception turns the gate red.
 */
import { describe, expect, it } from 'vitest';
import { annotatedIgnoreProblems, gitleaksIgnoreProblems, osvExceptionProblems, trivyExceptionProblems } from '../src/exceptions.ts';
import { filesBelow, read, today, yaml } from '../src/files.ts';

const TODAY = today();

describe('scanner exceptions (EVM-006 AC4)', () => {
  it('EVM-006 AC4 (A5): OSV exceptions are documented, expire and never cover malicious packages', () => {
    expect(osvExceptionProblems(read('osv-scanner.toml'), TODAY)).toEqual([]);
  });

  it('EVM-006 AC4: Trivy exceptions (misconfigurations, vulnerabilities, licenses) are documented and expire', () => {
    expect(trivyExceptionProblems(yaml('.trivyignore.yaml'), TODAY)).toEqual([]);
  });

  it('EVM-006 AC5 (A3): gitleaks exceptions are fingerprints of false positives with reason, owner and review date', () => {
    expect(gitleaksIgnoreProblems(read('.gitleaksignore'), TODAY)).toEqual([]);
  });

  it('EVM-006 AC4: zizmor ignores (config and inline) and nosemgrep comments carry reason, owner and review date', () => {
    const problems = [
      ...annotatedIgnoreProblems('zizmor.yml', read('zizmor.yml'), /^\s+-\s/, TODAY),
      ...filesBelow('.github/workflows', (path) => path.endsWith('.yml')).flatMap((path) =>
        annotatedIgnoreProblems(path, read(path), /zizmor:\s*ignore\[/, TODAY),
      ),
      ...['apps', 'packages', 'services', 'tools']
        .flatMap((dir) => filesBelow(dir, (path) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path)))
        .filter((path) => !path.startsWith('tools/repo-policy/'))
        .flatMap((path) => annotatedIgnoreProblems(path, read(path), /nosemgrep/, TODAY)),
    ];
    expect(problems).toEqual([]);
  });

  it('EVM-006 AC4 (W7): .semgrepignore stays narrow — generated output and the rule fixtures only', () => {
    const entries = read('.semgrepignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(entries).toEqual(['node_modules/', 'dist/', 'coverage/', '.turbo/', '.semgrep/']);
  });

  it('EVM-006 AC4: zizmor blocks from severity low with the default persona; osv-scanner.toml has no other sections', () => {
    expect(read('tools/scan/lib/steps.mjs')).toContain(
      "const ZIZMOR_COMMON = ['--offline', '--min-severity', 'low', '--format', 'json', '--no-exit-codes'];",
    );
    expect(read('tools/scan/lib/steps.mjs')).not.toContain('--persona');
  });
});
