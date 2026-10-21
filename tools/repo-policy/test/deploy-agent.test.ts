/**
 * The deployment verifier as a sensitive, self-contained workspace (EVM-007 AC3; ADR-0018 m5, K3; architect 1, 2).
 */
import { describe, expect, it } from 'vitest';
import { json, list, read, record, text, yaml } from '../src/files.ts';

describe('services/deploy-agent (EVM-007 AC3)', () => {
  it('EVM-007 AC3 (architect 1): the verifier imports nothing of apps, packages or tools, and nothing imports it', () => {
    const config = read('.dependency-cruiser.cjs');
    expect(config).toContain("name: 'deploy-agent-self-contained'");
    expect(config).toContain("from: { path: '^services/deploy-agent/(src|test)/' }");
    expect(config).toContain("to: { path: '^(apps|packages|tools|services/(?!deploy-agent/))' }");
    expect(config).toContain("name: 'nothing-imports-deploy-agent'");
    const pkg = record(json('services/deploy-agent/package.json'));
    expect(Object.keys(record(pkg['dependencies']))).toEqual(['yaml']);
    expect(text(record(pkg['scripts'])['test:coverage'])).toBe('vitest run --coverage');
    expect(read('services/deploy-agent/vitest.config.ts')).toContain("coverage({ layer: 'shared'");
  });

  it('EVM-007 AC3 (K3, architect 2): services/deploy-agent and infra are sensitive files — CODEOWNERS and the K3 summary of CI', () => {
    expect(read('.github/CODEOWNERS')).toContain('/services/deploy-agent/ @konradkluz');
    expect(read('.github/CODEOWNERS')).toContain('/infra/                @konradkluz');
    const security = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['security']);
    const k3 = list(security['steps'])
      .map(record)
      .find((step) => text(step['name']).includes('(K3)'));
    expect(text(k3?.['run'])).toContain('infra services/deploy-agent');
  });

  it('EVM-007 AC3: the coverage reports of services/* reach changed-code coverage in CI', () => {
    const quality = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['quality']);
    const upload = list(quality['steps'])
      .map(record)
      .find((step) => record(step['with'])['name'] === 'lcov-quality');
    expect(text(record(upload?.['with'])['path'])).toContain('services/*/coverage/lcov.info');
  });
});
