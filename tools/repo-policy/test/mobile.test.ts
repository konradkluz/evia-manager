/**
 * The Android package in CI on the real repository (EVM-009 AC5, AC6; security-engineer B1, B2, B3, B5, B8): the build job without
 * secrets and the signing job that alone holds the key (nothing checked out, nothing installed, no cache).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { list, read, record, text, yaml } from '../src/files.ts';
import { MOBILE_SIGN_SECRETS, mobileSignJobProblems, secretsOnlyInMobileSign, workflowProblems } from '../src/workflows.ts';

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
/** A step of the signing job by index or by predicate; throws when there is none (a test bug). */
const signStep = (document: Doc, which: number | ((step: Record<string, unknown>) => boolean)): Record<string, unknown> => {
  const all = document.jobs['mobile-sign']?.['steps'] as Array<Record<string, unknown>>;
  const found = typeof which === 'number' ? all[which] : all.find(which);
  if (found === undefined) throw new Error('no such step');
  return found;
};
const signingStep = (document: Doc): Record<string, unknown> => {
  const found = (document.jobs['mobile-sign']?.['steps'] as Array<Record<string, unknown>>).find((step) =>
    JSON.stringify(step).includes('secrets.'),
  );
  if (found === undefined) throw new Error('no signing step');
  return found;
};

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

describe('mobile-sign (EVM-009 AC5; security-engineer B1)', () => {
  it('EVM-009 AC5: holds the key in the env of one step, checks out nothing, uses no cache, runs after mobile-apk on main only, outside ci-gate', () => {
    expect(mobileSignJobProblems(ci)).toEqual([]);
    expect(secretsOnlyInMobileSign(ci)).toBe(true);
    expect(list(job('ci-gate')['needs'])).not.toContain('mobile-sign');
    expect(Object.keys(record(signingStep(real())['env']))).toEqual([...MOBILE_SIGN_SECRETS]);
    const used = steps('mobile-sign')
      .map((step) => text(step['uses']).split('@')[0])
      .filter(Boolean);
    expect(used).toEqual(['actions/download-artifact', 'actions/upload-artifact']);
  });

  it('EVM-009 AC5: the generic workflow rules accept secrets in ci.yml only in the signing step', () => {
    expect(workflowProblems('.github/workflows/ci.yml', read('.github/workflows/ci.yml'), ci)).toEqual([]);
    expect(read('.github/workflows/ci.yml').match(/secrets\./g)).toHaveLength(MOBILE_SIGN_SECRETS.length);
  });

  it('EVM-009 AC5: a secret anywhere else — another job, the job env, a with, a run, a changed name — is reported', () => {
    const cases: Array<[string, (w: Doc) => void]> = [
      ['another job', (w) => void ((w.jobs['quality'] as Record<string, unknown>)['env'] = { X: '${{ secrets.ANDROID_KEY_PASSWORD }}' })],
      [
        'job env of mobile-sign',
        (w) => void ((w.jobs['mobile-sign'] as Record<string, unknown>)['env'] = { X: '${{ secrets.ANDROID_KEY_PASSWORD }}' }),
      ],
      [
        'a with of another step',
        (w) =>
          void (signStep(w, 0)['with'] = {
            token: '${{ secrets.ANDROID_KEY_PASSWORD }}',
          }),
      ],
      ['a changed name', (w) => void (record(signingStep(w)['env'])['ANDROID_KEY_PASSWORD'] = '${{ secrets.OTHER }}')],
      ['a fifth secret', (w) => void (record(signingStep(w)['env'])['EXTRA'] = '${{ secrets.EXTRA }}')],
    ];
    for (const [name, mutate] of cases) {
      const workflow = real();
      mutate(workflow);
      expect(secretsOnlyInMobileSign(workflow), name).toBe(false);
    }
    const inRun = real();
    signingStep(inRun)['run'] = `${text(signingStep(inRun)['run'])}\necho '\${{ secrets.ANDROID_KEY_PASSWORD }}'`;
    expect(secretsOnlyInMobileSign(inRun), 'a run').toBe(false);
  });

  it('EVM-009 AC5: every weakening of the signing job is reported with its own message', () => {
    const cases: Array<[string, (w: Doc) => void, string]> = [
      [
        'a checkout',
        (w) => void (w.jobs['mobile-sign']?.['steps'] as unknown[]).unshift({ uses: 'actions/checkout@abc' }),
        'zabronione actions/checkout',
      ],
      [
        'an install',
        (w) => void (w.jobs['mobile-sign']?.['steps'] as unknown[]).unshift({ uses: 'pnpm/action-setup@abc' }),
        'zabronione pnpm/action-setup',
      ],
      [
        'a cache',
        (w) => void (w.jobs['mobile-sign']?.['steps'] as unknown[]).unshift({ uses: 'actions/cache@abc' }),
        'zabronione actions/cache',
      ],
      [
        'another action',
        (w) => void (w.jobs['mobile-sign']?.['steps'] as unknown[]).unshift({ uses: 'some/action@abc' }),
        'dozwolone wyłącznie download-artifact',
      ],
      ['any branch', (w) => void ((w.jobs['mobile-sign'] as Record<string, unknown>)['if'] = "github.event_name == 'push'"), 'wymagane if'],
      ['other needs', (w) => void ((w.jobs['mobile-sign'] as Record<string, unknown>)['needs'] = ['changes']), 'needs = [mobile-apk]'],
      [
        'write permission',
        (w) => void ((w.jobs['mobile-sign'] as Record<string, unknown>)['permissions'] = { contents: 'write' }),
        'permissions',
      ],
      [
        'a job env',
        (w) => void ((w.jobs['mobile-sign'] as Record<string, unknown>)['env'] = { A: '1' }),
        'zabronione env na poziomie joba',
      ],
      ['no cleanup', (w) => void (w.jobs['mobile-sign']?.['steps'] as Array<Record<string, unknown>>).splice(-2, 1), 'always()'],
      [
        'cleanup without always',
        (w) => void (signStep(w, (step) => text(step['name']).startsWith('Remove'))['if'] = 'success()'),
        'always()',
      ],
      ['no shell bash', (w) => void (signingStep(w)['shell'] = 'sh'), 'shell: bash'],
      ['an if on the signing step', (w) => void (signingStep(w)['if'] = 'always()'), 'bez if'],
      ['set -x', (w) => void (signingStep(w)['run'] = `set -x\n${text(signingStep(w)['run'])}`), 'bez set -x'],
      [
        'password in an argument',
        (w) =>
          void (signingStep(w)['run'] = text(signingStep(w)['run']).replace('--ks-pass env:ANDROID_KEYSTORE_PASSWORD', '--ks-pass pass:x')),
        '--ks-pass env:ANDROID_KEYSTORE_PASSWORD',
      ],
      [
        'password via file',
        (w) => void (signingStep(w)['run'] = `${text(signingStep(w)['run'])}\n--key-pass file:/tmp/p`),
        'wyłącznie przez env:',
      ],
      [
        'an echoed password',
        (w) => void (signingStep(w)['run'] = `${text(signingStep(w)['run'])}\necho "$ANDROID_KEY_PASSWORD"`),
        'wypisuje sekret',
      ],
      [
        'an expression in run',
        (w) => void (signingStep(w)['run'] = `${text(signingStep(w)['run'])}\necho \${{ github.sha }}`),
        'bez wyrażeń',
      ],
      ['no trap', (w) => void (signingStep(w)['run'] = text(signingStep(w)['run']).replace('trap ', 'true ')), 'trap '],
      ['no umask', (w) => void (signingStep(w)['run'] = text(signingStep(w)['run']).replace('umask 077', 'true')), 'umask 077'],
    ];
    for (const [name, mutate, fragment] of cases) {
      const workflow = real();
      mutate(workflow);
      expect(mobileSignJobProblems(workflow).join('\n'), name).toContain(fragment);
    }
    expect(mobileSignJobProblems({ jobs: {} })).toEqual(['ci.yml: mobile-sign: brak joba']);
    const noSecret = real();
    (noSecret.jobs['mobile-sign']?.['steps'] as Array<Record<string, unknown>>).splice(1, 1);
    expect(mobileSignJobProblems(noSecret).join('\n')).toContain('brak kroku podpisu');
  });
});

describe('the signing script, run for real with a fake apksigner (EVM-009 AC5; security-engineer B1)', () => {
  const script = text(signingStep(real())['run']);
  const bash = spawnSync('bash', ['--version']).status === 0;

  /** A runner-like folder: the downloaded unsigned package, a build-tools folder with fake zipalign and apksigner. */
  function runner(): { root: string; env: Record<string, string>; log: string } {
    const root = mkdtempSync(join(tmpdir(), 'evia-sign-'));
    const tools = join(root, 'sdk', 'build-tools');
    mkdirSync(join(tools, '35.0.0'), { recursive: true });
    mkdirSync(join(tools, '36.0.0'), { recursive: true });
    mkdirSync(join(root, 'unsigned'), { recursive: true });
    mkdirSync(join(root, 'temp'), { recursive: true });
    writeFileSync(join(root, 'unsigned', 'evia-manager-0.1.0-b7-release-unsigned.apk'), 'unsigned package bytes');
    const log = join(root, 'calls.log');
    const fake = (name: string, body: string): void => {
      const path = join(tools, '36.0.0', name);
      writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(path, 0o755);
    };
    fake('zipalign', `echo "zipalign $*" >> "${log.replaceAll('\\', '/')}"`);
    fake(
      'apksigner',
      [
        `echo "apksigner $*" >> "${log.replaceAll('\\', '/')}"`,
        'if [ "$1" = "sign" ]; then',
        '  out=""; for ((i=1;i<=$#;i++)); do if [ "${!i}" = "--out" ]; then j=$((i+1)); out="${!j}"; fi; done',
        '  test -f "$ANDROID_TEST_KEYSTORE_MARK" || true',
        '  printf signed > "$out"',
        'else',
        '  echo "Verified using v2 scheme (APK Signature Scheme v2): true"',
        '  echo "Verified using v3 scheme (APK Signature Scheme v3): true"',
        '  echo "Signer #1 certificate SHA-256 digest: aabbcc"',
        'fi',
      ].join('\n'),
    );
    const posix = (path: string): string => path.replaceAll('\\', '/');
    return {
      root,
      log,
      env: {
        PATH: process.env['PATH'] ?? '',
        ANDROID_HOME: posix(join(root, 'sdk')),
        RUNNER_TEMP: posix(join(root, 'temp')),
        GITHUB_STEP_SUMMARY: posix(join(root, 'summary.md')),
      },
    };
  }

  const execute = (root: string, env: Record<string, string>) => spawnSync('bash', ['-c', script], { cwd: root, env, encoding: 'utf8' });

  it.skipIf(!bash)('EVM-009 AC5: without any secret it succeeds, warns, signs nothing and says the package stays unsigned', () => {
    const { root, env } = runner();
    try {
      const result = execute(root, env);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('::warning::No signing secrets');
      expect(readFileSync(join(root, 'summary.md'), 'utf8')).toContain('NIEPODPISANY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!bash)('EVM-009 AC5: with an incomplete set of secrets it fails and names only the missing variables', () => {
    const { root, env } = runner();
    try {
      const result = execute(root, { ...env, ANDROID_KEYSTORE_BASE64: 'c3ludGhldGlj', ANDROID_KEY_ALIAS: 'alias' });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('missing: ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD');
      expect(result.stdout + result.stderr).not.toContain('c3ludGhldGlj');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!bash)(
    'EVM-009 AC5: with all secrets it signs with v2 and v3, passes the passwords as environment variables, prints no secret and removes the keystore',
    () => {
      const { root, env, log } = runner();
      try {
        const secrets = {
          ANDROID_KEYSTORE_BASE64: Buffer.from('synthetic keystore bytes').toString('base64'),
          ANDROID_KEYSTORE_PASSWORD: 'synthetic-store-password',
          ANDROID_KEY_ALIAS: 'synthetic-alias',
          ANDROID_KEY_PASSWORD: 'synthetic-key-password',
        };
        const result = execute(root, { ...env, ...secrets });
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const calls = readFileSync(log, 'utf8');
        expect(calls).toContain('zipalign -c -P 16 4 unsigned/evia-manager-0.1.0-b7-release-unsigned.apk');
        expect(calls).toContain('--ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD');
        expect(calls).toContain('--out signed/evia-manager-0.1.0-b7-release.apk');
        expect(calls).toContain('verify --verbose --print-certs signed/evia-manager-0.1.0-b7-release.apk');
        expect(readFileSync(join(root, 'signed', 'evia-manager-0.1.0-b7-release.apk'), 'utf8')).toBe('signed');
        const everything = result.stdout + result.stderr + calls + readFileSync(join(root, 'summary.md'), 'utf8');
        // the alias is not a secret and is an argument of apksigner by design; the keystore and the passwords never are
        for (const [name, secret] of Object.entries(secrets)) {
          if (name !== 'ANDROID_KEY_ALIAS') expect(everything, `${name} leaked`).not.toContain(secret);
        }
        expect(readFileSync(join(root, 'summary.md'), 'utf8')).toContain('APK podpisany');
        expect(readFileSync(join(root, 'summary.md'), 'utf8')).toContain('certificate SHA-256 digest: aabbcc');
        expect(spawnSync('bash', ['-c', `test ! -e "${env['RUNNER_TEMP']}/evia-release.keystore"`]).status).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!bash)('EVM-009 AC5: a signature that apksigner does not verify with v2 and v3 fails the job', () => {
    const { root, env } = runner();
    try {
      const tools = join(root, 'sdk', 'build-tools', '36.0.0', 'apksigner');
      writeFileSync(
        tools,
        '#!/usr/bin/env bash\nif [ "$1" = "sign" ]; then printf x > "${@: -2:1}"; else echo "Verified using v2 scheme (APK Signature Scheme v2): false"; fi\n',
      );
      chmodSync(tools, 0o755);
      const result = execute(root, {
        ...env,
        ANDROID_KEYSTORE_BASE64: 'c3ludGhldGlj',
        ANDROID_KEYSTORE_PASSWORD: 'p',
        ANDROID_KEY_ALIAS: 'a',
        ANDROID_KEY_PASSWORD: 'k',
      });
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
