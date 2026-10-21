/**
 * The Android package in CI on the real repository (EVM-009 AC5, AC6; security-engineer B1, B2, B3, B5, B8): the build job without
 * secrets and no signing in CI at all (the package is signed locally by the owner; docs/ops/dystrybucja-apk-android.md).
 */
import { describe, expect, it } from 'vitest';
import { list, read, record, text, yaml } from '../src/files.ts';
import { workflowProblems } from '../src/workflows.ts';

type Doc = { jobs: Record<string, Record<string, unknown>> };

const ci = record(yaml('.github/workflows/ci.yml'));
const jobs = record(ci['jobs']);
const job = (name: string): Record<string, unknown> => record(jobs[name]);
const steps = (name: string): Array<Record<string, unknown>> => list(job(name)['steps']).map(record);
const runs = (name: string): string[] =>
  steps(name)
    .map((step) => text(step['run']))
    .filter(Boolean);
const real = (): Doc => structuredClone(yaml('.github/workflows/ci.yml')) as Doc;

describe('mobile-apk (EVM-009 AC5, AC6)', () => {
  it('EVM-009 AC5: builds on its own output of changes, within 30 minutes, with read-only permissions and no secret', () => {
    const build = job('mobile-apk');
    expect(build['if']).toBe("needs.changes.outputs.mobile == 'true'");
    expect(list(build['needs'])).toEqual(['changes']);
    expect(build['timeout-minutes']).toBe(30);
    expect(build['permissions']).toEqual({ contents: 'read' });
    expect(JSON.stringify(build)).not.toContain('secrets.');
    expect(record(build['env'])['EXPO_NO_TELEMETRY']).toBe('1');
  });

  it('EVM-009 AC6 (B5): the API address of the build is a repository variable with a reserved placeholder, never a secret', () => {
    expect(record(job('mobile-apk')['env'])['EXPO_PUBLIC_API_BASE_URL']).toBe(
      "${{ vars.EVIA_API_BASE_URL || 'https://api.example.invalid' }}",
    );
  });

  it('EVM-009 AC5: a frozen lockfile, a clean prebuild, assembleRelease, the run number in the version code, no EAS and no other public variable', () => {
    const commands = runs('mobile-apk').join('\n');
    expect(commands).toContain('pnpm install --frozen-lockfile');
    expect(commands).toContain('expo prebuild --platform android --clean --no-install');
    expect(commands).toContain('./gradlew assembleRelease');
    expect(commands).toContain('EVIA_ANDROID_VERSION_CODE="$((GITHUB_RUN_NUMBER + 100000))"');
    expect(commands).not.toMatch(/\beas\b|expo login/);
    expect(JSON.stringify(job('mobile-apk'))).not.toMatch(/EXPO_PUBLIC_(?!API_BASE_URL)/);
  });

  it('EVM-009 AC5, AC6 (B2, B3): verifies the finished package, writes its digest and uploads only the UNSIGNED package for 14 days', () => {
    const commands = runs('mobile-apk');
    expect(commands.some((command) => command.includes('tools/mobile-apk/cli.mjs verify --apk "$APK"'))).toBe(true);
    expect(commands.some((command) => command.includes('tools/mobile-apk/cli.mjs digest --apk "$APK"'))).toBe(true);
    const upload = steps('mobile-apk').find((step) => text(step['uses']).startsWith('actions/upload-artifact@'));
    expect(record(upload?.['with'])).toMatchObject({
      name: 'mobile-apk-unsigned',
      path: 'dist/*-release-unsigned.apk',
      'retention-days': 14,
    });
    expect(JSON.stringify(job('mobile-apk'))).not.toMatch(/debug/i);
  });
});

describe('no signing in CI (EVM-009 AC5; decision 2026-10-20, RR-21)', () => {
  const problemsOf = (document: unknown, raw: string = JSON.stringify(document)): string =>
    workflowProblems('.github/workflows/ci.yml', raw, document).join('\n');

  it('EVM-009 AC5: ci.yml has no mobile-sign job and no secret at all, and the real file passes the generic rules', () => {
    expect(Object.keys(jobs)).not.toContain('mobile-sign');
    const raw = read('.github/workflows/ci.yml');
    expect(raw).not.toContain('secrets.');
    expect(raw).not.toMatch(/ANDROID_KEY|mobile-sign/);
    expect(workflowProblems('.github/workflows/ci.yml', raw, ci)).toEqual([]);
    expect(list(job('ci-gate')['needs'])).toContain('mobile-apk');
  });

  it('EVM-009 AC5: a workflow with a mobile-sign job or with secrets.ANDROID_* is reported', () => {
    const withJob = real();
    withJob.jobs['mobile-sign'] = { name: 'mobile-sign', 'runs-on': 'ubuntu-24.04', steps: [] };
    expect(problemsOf(withJob)).toContain('podpis APK wyłącznie lokalnie');
    const withSecret = real();
    (withSecret.jobs['mobile-apk'] as Record<string, unknown>)['env'] = {
      ANDROID_KEYSTORE_PASSWORD: '${{ secrets.ANDROID_KEYSTORE_PASSWORD }}',
    };
    const problems = problemsOf(withSecret);
    expect(problems).toContain('sekrety (secrets.) wyłącznie w renovate.yml');
    expect(problems).toContain('podpis APK wyłącznie lokalnie');
    expect(problemsOf({ jobs: {} }, 'env:\n  ANDROID_KEY_ALIAS: x\n')).toContain('podpis APK wyłącznie lokalnie');
  });
});
