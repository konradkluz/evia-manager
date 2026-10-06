import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parseArguments } from '../../src/cli/args.ts';
import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE, executeBootstrap, type BootstrapDependencies, type TerminalIo } from '../../src/cli/run.ts';
import { interactiveRefusal } from '../../src/cli/tty-guard.ts';
import type { BootstrapResult } from '../../src/modules/identity/index.ts';
import { EMERGENCY_REASONS } from '../../src/modules/identity/index.ts';

const reasons = [...EMERGENCY_REASONS];
const PANEL = 'https://panel.evia.test';
const TOKEN = 'T'.repeat(43);

describe('where the server command may run (EVM-016 AC1; SR-AUTH-12, SR-LOG-02)', () => {
  const tty = { stdinIsTTY: true, stdoutIsTTY: true, pid: 4242, ppid: 4000 };

  it('EVM-016 AC1 a terminal on both streams started from a shell (docker exec -it) is allowed', () => {
    expect(interactiveRefusal(tty)).toBeUndefined();
  });

  it.each([
    ['stdin is not a terminal', { stdinIsTTY: false }],
    ['stdout is not a terminal (piped to logs)', { stdoutIsTTY: false }],
    ['stdin is unknown', { stdinIsTTY: undefined }],
    ['stdout is unknown', { stdoutIsTTY: undefined }],
  ])('EVM-016 AC1 %s: refused without a link', (_label, facts) => {
    expect(interactiveRefusal({ ...tty, ...facts })).toMatch(/terminala interaktywnego/);
  });

  it('EVM-016 AC1 as the main process of a container (pid 1) or its direct child (init is pid 1) it is refused even with a TTY (docker compose run -t)', () => {
    expect(interactiveRefusal({ ...tty, pid: 1 })).toMatch(/głównym procesem kontenera/);
    expect(interactiveRefusal({ ...tty, ppid: 1 })).toMatch(/docker exec -it/);
    expect(interactiveRefusal({ ...tty, pid: 2, ppid: 2 })).toBeUndefined();
  });
});

describe('arguments (EVM-016 AC1, AC2; SR-AUTH-12, ASVS V6.4.1)', () => {
  it('EVM-016 AC1 no arguments means the first Administrator; the address comes from the terminal, not from argv', () => {
    expect(parseArguments([], reasons)).toEqual({ ok: true, emergency: false });
  });

  it('EVM-016 AC2 the emergency mode needs --emergency and a reason from the closed list', () => {
    expect(parseArguments(['--emergency', '--reason', 'lost_device'], reasons)).toEqual({
      ok: true,
      emergency: true,
      reason: 'lost_device',
    });
    expect(parseArguments(['--reason', 'lost_credentials', '--emergency'], reasons)).toEqual({
      ok: true,
      emergency: true,
      reason: 'lost_credentials',
    });
    for (const argv of [
      ['--emergency'],
      ['--emergency', '--reason'],
      ['--emergency', '--reason', 'because i said so'],
      ['--emergency', '--reason', 'jan@evia.invalid'],
    ]) {
      expect(parseArguments(argv, reasons), argv.join(' ')).toMatchObject({ ok: false });
    }
    expect(parseArguments(['--reason', 'other'], reasons)).toMatchObject({ ok: false });
  });

  it.each([
    ['--password', 'hunter2'],
    ['--password=hunter2'],
    ['--pass', 'x'],
    ['--email', 'jan.przykladowy@evia.invalid'],
    ['--account', 'jan.przykladowy@evia.invalid'],
    ['--token', 'abc'],
    ['jan.przykladowy@evia.invalid'],
    ['-e'],
    ['--emergency', '--password', 'x', '--reason', 'other'],
  ])('EVM-016 AC1 %j is rejected: a password, a token or an address can never be passed on the command line', (...argv) => {
    const parsed = parseArguments(argv, reasons);
    expect(parsed).toMatchObject({ ok: false });
    expect(JSON.stringify(parsed)).not.toMatch(/hunter2|jan\.przykladowy/);
  });
});

/** A terminal with scripted answers that remembers everything written to it. */
function terminal(answers: string[]) {
  const written: string[] = [];
  const asked: string[] = [];
  const io: TerminalIo = {
    question: (prompt) => {
      asked.push(prompt);
      return Promise.resolve(answers.shift() ?? '');
    },
    write: (text) => {
      written.push(text);
    },
  };
  return { io, written, asked, output: () => written.join('') };
}

function service(result: BootstrapResult) {
  const run = vi.fn<BootstrapDependencies['bootstrap']['run']>(() => Promise.resolve(result));
  const dependencies: BootstrapDependencies = { bootstrap: { run }, panelOrigin: PANEL };
  return { run, dependencies };
}

const issued: BootstrapResult = { kind: 'issued', token: TOKEN, expiresAt: new Date('2026-10-04T08:00:00Z') };

describe('the command flow (EVM-016 AC1, AC2; SR-AUTH-12, SR-LOG-02)', () => {
  it('EVM-016 AC1 the address is typed at the prompt, normalised, and the link is printed on the terminal with the token in the fragment only', async () => {
    const { io, output, asked } = terminal(['  Jan.Przykladowy@EVIA.invalid ']);
    const { run, dependencies } = service(issued);
    expect(await executeBootstrap([], io, dependencies)).toBe(EXIT_OK);
    expect(asked).toHaveLength(1);
    expect(run).toHaveBeenCalledWith(
      { mode: 'activation', email: 'jan.przykladowy@evia.invalid' },
      { origin: 'cli', traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown },
    );
    const link = /https:\/\/\S+/.exec(output())?.[0] ?? '';
    expect(link).toBe(`${PANEL}/activate#${TOKEN}`);
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe(`#${TOKEN}`);
    expect(output()).toContain('72 godziny');
    expect(output()).toContain('4 paź 2026, 10:00');
    expect(output()).toContain('Nie wklejaj go');
  });

  it('EVM-016 AC1 the host of the link is the configured origin of the panel, nothing else', async () => {
    const { io, output } = terminal(['jan.przykladowy@evia.invalid']);
    await executeBootstrap([], io, { ...service(issued).dependencies, panelOrigin: 'https://other-panel.evia.test:8443' });
    expect(output()).toContain(`https://other-panel.evia.test:8443/activate#${TOKEN}`);
  });

  it.each(['', 'not an address', 'jan@', '@evia.invalid', 'a b@evia.invalid', `${'x'.repeat(250)}@evia.invalid`])(
    'EVM-016 AC1 %j is not an address: refused before the use case runs',
    async (answer) => {
      const { io, output } = terminal([answer]);
      const { run, dependencies } = service(issued);
      expect(await executeBootstrap([], io, dependencies)).toBe(EXIT_REFUSED);
      expect(run).not.toHaveBeenCalled();
      expect(output()).not.toContain(TOKEN);
    },
  );

  it('EVM-016 AC1 a bad argument ends the command with the usage code before anything is asked', async () => {
    const { io, asked } = terminal([]);
    const { run, dependencies } = service(issued);
    expect(await executeBootstrap(['--password', 'x'], io, dependencies)).toBe(EXIT_USAGE);
    expect(asked).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('EVM-016 AC2 a refusal says why in general words and prints no link; both refusals are generic about the account', async () => {
    for (const reason of ['active_administrator_exists', 'account_unavailable'] as const) {
      const { io, output } = terminal(['jan.przykladowy@evia.invalid']);
      expect(await executeBootstrap([], io, service({ kind: 'refused', reason }).dependencies)).toBe(EXIT_REFUSED);
      expect(output()).toMatch(/^Odmowa/);
      expect(output()).not.toMatch(/https?:|#|jan\.przykladowy/);
    }
  });

  it('EVM-016 AC2 the emergency mode asks for the address twice and only a matching confirmation runs the reset', async () => {
    const { io, output, asked } = terminal(['Admin@evia.invalid', 'admin@EVIA.invalid ']);
    const { run, dependencies } = service(issued);
    expect(await executeBootstrap(['--emergency', '--reason', 'suspected_compromise'], io, dependencies)).toBe(EXIT_OK);
    expect(asked).toHaveLength(2);
    expect(run).toHaveBeenCalledWith({ mode: 'emergency', email: 'admin@evia.invalid', reason: 'suspected_compromise' }, expect.anything());
    expect(output()).toContain('TRYB AWARYJNY');
  });

  it('EVM-016 AC2 a wrong confirmation changes nothing', async () => {
    const { io, output } = terminal(['admin@evia.invalid', 'someone-else@evia.invalid']);
    const { run, dependencies } = service(issued);
    expect(await executeBootstrap(['--emergency', '--reason', 'other'], io, dependencies)).toBe(EXIT_REFUSED);
    expect(run).not.toHaveBeenCalled();
    expect(output()).toContain('Nic nie zmieniono');
  });

  it('EVM-016 AC2 an unknown message code still ends in a plain refusal', async () => {
    const { io, output } = terminal(['jan.przykladowy@evia.invalid']);
    const unknown = { kind: 'refused', reason: 'something_else' } as unknown as BootstrapResult;
    expect(await executeBootstrap([], io, service(unknown).dependencies)).toBe(EXIT_REFUSED);
    expect(output()).toBe('Odmowa.\n');
  });
});

describe('the process without a terminal (EVM-016 AC1; SR-LOG-02)', () => {
  /** Runs the real entry point with piped streams — what `docker compose run` or a cron job would give it. */
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['src/cli/bootstrap-admin.ts', ...args], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      input: 'jan.przykladowy@evia.invalid\n',
      timeout: 20_000,
      env: {
        PATH: process.env['PATH'] ?? '',
        // would be used if the command got as far as the database: it must not
        DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
        PANEL_ORIGIN: PANEL,
        WEBAUTHN_RP_ID: 'panel.evia.test',
        MIN_SUPPORTED_APP_VERSION_ANDROID: '1.0.0',
        MIN_SUPPORTED_APP_VERSION_IOS: '1.0.0',
      },
    });

  it('EVM-016 AC1 without a terminal the command refuses (exit 2), prints no link and no token, and never reaches the database', () => {
    for (const args of [[], ['--emergency', '--reason', 'lost_device'], ['--password', 'hunter2']]) {
      const result = run(args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/terminala interaktywnego/);
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/activate|https:|#|ECONNREFUSED|hunter2/);
    }
  });
});
