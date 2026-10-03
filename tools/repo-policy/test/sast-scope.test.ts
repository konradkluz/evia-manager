/**
 * Scope of SAST (EVM-006 AC4, bramka 2; architect W7) — added by qa-engineer. Semgrep sees only the directories that
 * compose.yaml mounts and that tools/scan passes as targets. When EVM-008 / EVM-009 add apps/ and services/, both
 * places must grow with them; otherwise their code would silently stay outside the SAST gate (green with nothing scanned).
 */
import { describe, expect, it } from 'vitest';
import { SECURITY_STEPS } from '../../scan/lib/steps.mjs';
import { exists, list, record, yaml } from '../src/files.ts';

const ROOTS = ['apps', 'services', 'packages', 'tools'].filter((dir) => exists(dir));
const semgrepMounts = list(record(record(record(yaml('compose.yaml'))['services'])['scan-semgrep'])['volumes']).map(String);

describe('SAST scope (EVM-006 AC4, bramka 2)', () => {
  it('EVM-006 AC4: Semgrep mounts and scans every workspace root directory that exists', () => {
    const semgrep = SECURITY_STEPS.find((step) => step.id === 'semgrep');
    expect(semgrep?.service).toBe('scan-semgrep');
    expect(ROOTS).toContain('packages');
    for (const root of ROOTS) {
      expect(semgrepMounts, root).toContain(`./${root}:/src/${root}:ro`);
      expect(semgrep?.args, root).toContain(root);
    }
  });

  it('EVM-006 AC4: every Semgrep target directory is mounted (a target without a mount would scan nothing)', () => {
    const semgrep = SECURITY_STEPS.find((step) => step.id === 'semgrep');
    const output = semgrep?.args.indexOf('/out/semgrep.json') ?? -1;
    const targets = semgrep?.args.slice(output + 1) ?? [];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(semgrepMounts, target).toContain(`./${target}:/src/${target}:ro`);
  });
});
