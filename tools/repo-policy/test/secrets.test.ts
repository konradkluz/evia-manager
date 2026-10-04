/**
 * Secrets: example configuration, ignored files, gitleaks configuration and hooks (EVM-006 AC5; SR-INFRA-05;
 * security-engineer A3).
 */
import { describe, expect, it } from 'vitest';
import { gitIgnores, read, record, text, yaml } from '../src/files.ts';
import { envExampleProblems, gitleaksConfigProblems } from '../src/secrets.ts';

describe('secrets (EVM-006 AC5)', () => {
  it('EVM-006 AC5: .env.example exists, explains the rules and contains no secret-like value', () => {
    const example = read('.env.example');
    expect(envExampleProblems(example)).toEqual([]);
    expect(example).toContain('NIGDY w katalogu');
  });

  it('EVM-006 AC5: .gitignore covers the stack, local secrets and working files, but not .env.example', () => {
    for (const path of [
      'node_modules/x',
      'packages/a/node_modules/x',
      '.turbo/x',
      'packages/a/dist/x.js',
      'coverage/x',
      'a.tsbuildinfo',
      '.env',
      '.env.local',
      '.scratch/x',
      'secrets/x',
      'k.pem',
    ]) {
      expect(gitIgnores(path), path).toBe(true);
    }
    for (const path of ['.env.example', 'compose.yaml', 'packages/tokens/src/build.ts']) expect(gitIgnores(path), path).toBe(false);
  });

  it('EVM-006 AC5 (A3): gitleaks uses the default rules without any allowlist', () => {
    expect(gitleaksConfigProblems(read('.gitleaks.toml'))).toEqual([]);
  });

  it('EVM-006 AC5 (A3): every gitleaks call redacts secrets and reads the repository configuration explicitly', () => {
    const steps = read('tools/scan/lib/steps.mjs');
    expect(steps).toContain("export const GITLEAKS_COMMON = ['--redact', '--no-banner', ...GITLEAKS_CONFIG];");
    expect(steps).toContain(
      "const GITLEAKS_CONFIG = ['--config', '/config/gitleaks.toml', '--gitleaks-ignore-path', '/config/gitleaksignore'];",
    );
    expect(steps.match(/service: 'scan-gitleaks'/g)?.length).toBe(steps.match(/\.\.\.GITLEAKS_COMMON/g)?.length);
    const hooks = read('tools/scan/lib/hooks.mjs');
    expect(hooks.match(/\.\.\.GITLEAKS_COMMON/g)?.length).toBe(2);
  });

  it('EVM-006 AC5: pre-commit checks format, lint and secrets without changing files; pre-push scans every pushed range', () => {
    const lefthook = record(yaml('lefthook.yml'));
    const preCommit = record(record(lefthook['pre-commit'])['commands']);
    const prePush = record(record(lefthook['pre-push'])['commands']);
    expect(text(record(preCommit['format'])['run'])).toBe('pnpm exec prettier --check --ignore-unknown {staged_files}');
    expect(text(record(preCommit['lint'])['run'])).toBe('pnpm exec eslint --no-warn-ignored {staged_files}');
    expect(text(record(preCommit['secrets'])['run'])).toBe('node tools/scan/cli.mjs hook pre-commit');
    expect(record(prePush['secrets'])).toEqual({ run: 'node tools/scan/cli.mjs hook pre-push', use_stdin: true });
    expect(read('lefthook.yml')).not.toMatch(/--fix|--write|stage_fixed/);
  });
});
