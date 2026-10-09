import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adminCommand, childEnv, devCommand, initCommand, RESET_PHRASE, resetCommand, seedCommand, stopCommand } from '../src/commands.mjs';
import { main, USAGE } from '../src/main.mjs';

const DOTENV = [
  'NODE_ENV=development',
  'WEBAUTHN_RP_ID=localhost',
  'DATABASE_URL=postgres://evia:evia-local@localhost:5442/evia_dev',
  'CURSOR_KEY=zzsecretkeyzzsecretkeyzzsecretkeyzzsecr',
].join('\n');

/**
 * @typedef {import('../src/docker.mjs').DockerResult} DockerResult
 * @typedef {{ status: number | null, stdout: string }} ToolResult
 * @typedef {import('../src/commands.mjs').Deps} Deps
 * @typedef {{
 *   states?: string[],
 *   answer?: string,
 *   dotenv?: string | null,
 *   docker?: (name: string) => DockerResult | undefined,
 *   build?: number,
 *   seed?: ToolResult,
 *   state?: ToolResult,
 *   panel?: number,
 *   deps?: Partial<Deps>,
 * }} Overrides
 */

/** @type {DockerResult} */
const OK = { status: 0, stderr: '', error: undefined };
/**
 * @param {number | null} status
 * @param {string} [stderr]
 * @param {Error} [error]
 * @returns {DockerResult}
 */
const failed = (status, stderr = '', error) => ({ status, stderr, error });

/**
 * Fake dependencies that record every effect in order.
 * @param {Overrides} [overrides]
 */
function world(overrides = {}) {
  /** @type {string[]} */
  const log = [];
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const states = overrides.states ?? ['none', 'invited'];
  let stateCall = 0;
  /** @type {Deps} */
  const deps = {
    root: '/repo',
    env: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    out: (text) => {
      out.push(text);
    },
    err: (text) => {
      err.push(text);
    },
    ask: (prompt) => {
      log.push(`ask:${prompt.split('\n')[0]?.slice(0, 20) ?? ''}`);
      return Promise.resolve(overrides.answer ?? 't');
    },
    readDotenv: () => (overrides.dotenv === undefined ? DOTENV : overrides.dotenv),
    docker: (name) => {
      log.push(`docker:${name}`);
      return Promise.resolve(overrides.docker?.(name) ?? OK);
    },
    buildTools: () => {
      log.push('build');
      return overrides.build ?? 0;
    },
    runTool: (command) => {
      log.push(`tool:${command}`);
      if (command === 'seed') return overrides.seed ?? { status: 0, stdout: '{"created":9,"existing":2}\n' };
      if (overrides.state) return overrides.state;
      const admin = states[Math.min(stateCall++, states.length - 1)] ?? 'none';
      return { status: 0, stdout: `{"guard":"ok","admin":"${admin}"}\n` };
    },
    runPanel: () => {
      log.push('panel');
      return Promise.resolve(overrides.panel ?? 0);
    },
    ...overrides.deps,
  };
  return { deps, log, text: () => out.join(''), errors: () => err.join('') };
}

describe('EVM-077 AC2: pnpm run dev', () => {
  it('EVM-077 AC2: prepares in order before the panel — up, state, Administrator, state, demo data, addresses, panel', async () => {
    const { deps, log, text } = world({ states: ['none', 'active'] });
    assert.equal(await devCommand(deps), 0);
    assert.deepEqual(log, ['docker:up', 'build', 'tool:state', 'docker:adminExec', 'build', 'tool:state', 'tool:seed', 'panel']);
    assert.match(text(), /http:\/\/localhost:5173/);
    assert.match(text(), /nie 127\.0\.0\.1/);
    assert.match(text(), /utworzono 9, już istniało 2/);
  });

  it('EVM-077 AC2/AC5: an already active Administrator changes nothing and is only reported; the demo data follows (repeat is safe)', async () => {
    const { deps, log, text } = world({ states: ['active'] });
    assert.equal(await devCommand(deps), 0);
    assert.ok(!log.includes('docker:adminExec'));
    assert.deepEqual(log.slice(-2), ['tool:seed', 'panel']);
    assert.match(text(), /już aktywny/);
  });

  it('EVM-077 AC5 (Konrad 2026-10-09): an invited Administrator gets the two-step message — the demo data wait for the activation', async () => {
    const { deps, log, text } = world({ states: ['invited'], answer: 'n' });
    assert.equal(await devCommand(deps), 0);
    assert.ok(!log.includes('docker:adminExec'));
    assert.ok(!log.includes('tool:seed'));
    assert.match(text(), /Dane demo pojawią się po aktywacji.*pnpm run dev/);
    assert.match(text(), /Zachowuję poprzedni link/);
    assert.equal(log.at(-1), 'panel');
  });

  it('EVM-077 AC5: an invited Administrator may get a new link (the old one is invalidated)', async () => {
    const { deps, log } = world({ states: ['invited', 'invited'], answer: 'tak' });
    assert.equal(await devCommand(deps), 0);
    assert.ok(log.includes('docker:adminExec'));
    assert.ok(!log.includes('tool:seed'));
  });

  it('EVM-077 AC2/AC5: without an interactive terminal it prints the manual command, issues no link and touches nothing', async () => {
    for (const tty of [{ stdinIsTTY: false }, { stdoutIsTTY: false }]) {
      const { deps, log, errors } = world({ deps: tty });
      assert.equal(await devCommand(deps), 2);
      assert.deepEqual(log, []);
      assert.match(errors(), /terminala interaktywnego.*pnpm run dev/);
      const admin = world({ deps: tty });
      assert.equal(await adminCommand(admin.deps), 2);
      assert.deepEqual(admin.log, []);
    }
  });

  it('EVM-077 AC2: a missing .env stops before Docker with the fix', async () => {
    const { deps, log, errors } = world({ dotenv: null });
    assert.equal(await devCommand(deps), 1);
    assert.deepEqual(log, []);
    assert.match(errors(), /brak pliku \.env[\s\S]*pnpm run dev:init/);
  });

  it('EVM-077 AC4: the guard refuses before any Docker call or write — no values in the message', async () => {
    const dotenv = DOTENV.replace('evia_dev', 'evia') + '\nPGOPTIONS=-c evia.env=local-dev';
    const { deps, log, errors } = world({ dotenv });
    assert.equal(await devCommand(deps), 1);
    assert.deepEqual(log, []);
    assert.match(errors(), /strażnik środowiska lokalnego odmawia/);
    assert.match(errors(), /nie ma opcji --force/);
    for (const secret of ['evia-local', 'zzsecretkey', 'local-dev']) assert.ok(!errors().includes(secret));
    for (const command of [seedCommand, adminCommand]) {
      const other = world({ dotenv });
      assert.equal(await command(other.deps), 1);
      assert.deepEqual(other.log, []);
    }
  });

  it('EVM-077 AC2: .env wins over the shell, and a PG* variable of the shell is refused', async () => {
    assert.deepEqual(childEnv({ NODE_ENV: 'production', A: '1' }, { NODE_ENV: 'development' }), { NODE_ENV: 'development', A: '1' });
    const { deps, log } = world({ deps: { env: { PGHOST: 'db.example.com' } } });
    assert.equal(await devCommand(deps), 1);
    assert.deepEqual(log, []);
  });

  /** @type {Array<{ kind: string, failure: DockerResult, expected: RegExp }>} */
  const upFailures = [
    {
      kind: 'Docker is not installed',
      failure: failed(null, '', Object.assign(new Error('x'), { code: 'ENOENT' })),
      expected: /Docker nie jest zainstalowany/,
    },
    {
      kind: 'the Docker daemon is down',
      failure: failed(1, 'error during connect: pipe/docker_engine'),
      expected: /Docker nie działa[\s\S]*Docker Desktop/,
    },
    {
      kind: 'a port is taken',
      failure: failed(1, 'Bind for 127.0.0.1:3000 failed: port is already allocated'),
      expected: /port 3000 lub 5442 jest zajęty/,
    },
    { kind: 'compose up fails otherwise', failure: failed(1, 'boom'), expected: /nie udało się uruchomić kontenerów dev/ },
  ];
  for (const { kind, failure, expected } of upFailures) {
    it(`EVM-077 AC2: ${kind} — exit ≠ 0, a named problem with the fix, no stack trace, containers stopped`, async () => {
      const { deps, log, errors } = world({ docker: (name) => (name === 'up' ? failure : undefined) });
      assert.equal(await devCommand(deps), 1);
      assert.deepEqual(log, ['docker:up', 'docker:down']);
      assert.match(errors(), expected);
      assert.match(errors(), /Co zrobić:/);
      assert.ok(!/\n\s+at /.test(errors()));
    });
  }

  it('EVM-077 AC2: a failure after the start (tools, state, guard in the database, Administrator, seed) stops the containers and exits ≠ 0', async () => {
    /** @type {Array<[Overrides, RegExp]>} */
    const cases = [
      [{ build: 1 }, /nie udało się zbudować narzędzi dev/],
      [{ state: { status: 3, stdout: '' } }, /strażnik bazy odmawia/],
      [{ state: { status: 1, stdout: '' } }, /nie udało się odczytać stanu bazy dev/],
      [{ state: { status: 0, stdout: 'garbage' } }, /nieoczekiwana odpowiedź/],
      [{ state: { status: 0, stdout: '{"admin":"other"}' } }, /nieoczekiwana odpowiedź/],
      [{ docker: (name) => (name === 'adminExec' ? failed(2) : undefined) }, /procedura Administratora/],
      [{ docker: (name) => (name === 'adminExec' ? failed(null, '', new Error('x')) : undefined) }, /procedura Administratora/],
      [{ states: ['active'], seed: { status: 3, stdout: '' } }, /strażnik bazy odmawia/],
      [{ states: ['active'], seed: { status: 1, stdout: '' } }, /nie udało się utworzyć danych demo/],
    ];
    for (const [overrides, expected] of cases) {
      const { deps, log, errors } = world(overrides);
      assert.equal(await devCommand(deps), 1, expected.source);
      assert.equal(log.at(-1), 'docker:down', expected.source);
      assert.ok(!log.includes('panel'));
      assert.match(errors(), expected);
    }
  });

  it('EVM-077 AC2: the state after the Administrator procedure is read again and may fail', async () => {
    let calls = 0;
    const { deps, log } = world({
      deps: {
        runTool: (command) => {
          log.push(`tool:${command}`);
          calls += 1;
          return calls === 1 ? { status: 0, stdout: '{"admin":"none"}' } : { status: 1, stdout: '' };
        },
      },
    });
    assert.equal(await devCommand(deps), 1);
    assert.equal(log.at(-1), 'docker:down');
  });

  it('EVM-077 AC7: a seed answer without counts is still reported', async () => {
    const { deps, text } = world({ states: ['active'], seed: { status: 0, stdout: 'ok' } });
    assert.equal(await devCommand(deps), 0);
    assert.match(text(), /Dane demo przygotowane/);
  });

  it('EVM-077 AC2: returns the exit code of the panel', async () => {
    assert.equal(await devCommand(world({ states: ['active'], panel: 130 }).deps), 130);
  });
});

describe('EVM-077 AC5, AC7: dev:admin and dev:seed', () => {
  it('EVM-077 AC5: dev:admin runs the guard and the procedure, and fails when the procedure fails', async () => {
    const ok = world({ states: ['none', 'active'] });
    assert.equal(await adminCommand(ok.deps), 0);
    assert.deepEqual(ok.log, ['build', 'tool:state', 'docker:adminExec', 'build', 'tool:state']);
    const refused = world({ states: ['none'], docker: () => failed(1) });
    assert.equal(await adminCommand(refused.deps), 1);
    assert.equal(await adminCommand(world({ states: ['active'] }).deps), 0);
    assert.equal(await adminCommand(world({ build: 1 }).deps), 1);
  });

  it('EVM-077 AC7: dev:seed seeds only with an active Administrator', () => {
    const active = world({ states: ['active'] });
    assert.equal(seedCommand(active.deps), 0);
    assert.deepEqual(active.log, ['build', 'tool:state', 'tool:seed']);
    const invited = world({ states: ['invited'] });
    assert.equal(seedCommand(invited.deps), 0);
    assert.ok(!invited.log.includes('tool:seed'));
    assert.match(invited.text(), /po aktywacji/);
    assert.equal(seedCommand(world({ build: 1 }).deps), 1);
  });
});

describe('EVM-077 AC1: dev:init', () => {
  it('EVM-077 AC1: reports creation without the value, an existing file, and failures', () => {
    /** @param {'created' | 'exists' | 'no-example' | 'failed'} status */
    const run = (status) => {
      const { deps, text, errors } = world();
      return { code: initCommand(deps, () => ({ status })), text: text(), errors: errors() };
    };
    assert.match(run('created').text, /Utworzono \.env.*nie jest wypisywana/);
    assert.match(run('exists').text, /już istnieje.*nie nadpisuję/);
    assert.equal(run('exists').code, 0);
    assert.equal(run('no-example').code, 1);
    assert.match(run('failed').errors, /nie udało się zapisać/);
  });
});

describe('EVM-077 AC3: dev:stop and dev:reset', () => {
  it('EVM-077 AC3: stop is `down` (without volumes); a failure is reported', async () => {
    const ok = world();
    assert.equal(await stopCommand(ok.deps), 0);
    assert.deepEqual(ok.log, ['docker:down']);
    const broken = world({ docker: () => failed(1) });
    assert.equal(await stopCommand(broken.deps), 1);
  });

  it('EVM-077 AC3: reset asks for the phrase, warns that it is irreversible, and removes only after the exact phrase', async () => {
    const { deps, log, text } = world({ answer: RESET_PHRASE });
    assert.equal(await resetCommand(deps), 0);
    assert.deepEqual(log, ['ask:Aby potwierdzić, wpi', 'docker:downVolumes']);
    assert.match(text(), /NIEODWRACALNA/);
    assert.match(text(), /bramek \(compose\.yaml\) nie są ruszane/);
  });

  it('EVM-077 AC3: without the exact phrase nothing changes (also "y", "tak", "--yes" or an empty answer)', async () => {
    for (const answer of ['', 'y', 'tak', '--yes', 'usuń dane', 'usuń dane dev!']) {
      const { deps, log, errors } = world({ answer });
      assert.equal(await resetCommand(deps), 1, answer);
      assert.ok(!log.includes('docker:downVolumes'));
      assert.match(errors(), /Nic nie zmieniono/);
    }
  });

  it('EVM-077 AC3: reset refuses without a terminal (a pipe cannot confirm), without .env, and when the guard refuses', async () => {
    for (const tty of [{ stdinIsTTY: false }, { stdoutIsTTY: false }]) {
      const { deps, log } = world({ answer: RESET_PHRASE, deps: tty });
      assert.equal(await resetCommand(deps), 2);
      assert.deepEqual(log, []);
    }
    assert.equal(await resetCommand(world({ dotenv: null, answer: RESET_PHRASE }).deps), 1);
    const guarded = world({ dotenv: DOTENV.replace('development', 'production'), answer: RESET_PHRASE });
    assert.equal(await resetCommand(guarded.deps), 1);
    assert.deepEqual(guarded.log, []);
  });

  it('EVM-077 AC3: a failing `down -v` is reported', async () => {
    const { deps } = world({ answer: RESET_PHRASE, docker: () => failed(1) });
    assert.equal(await resetCommand(deps), 1);
  });
});

describe('EVM-077 AC2: dispatch', () => {
  it('EVM-077 AC2: routes every command and refuses unknown or extra arguments (no --yes, no --force)', async () => {
    assert.equal(await main(['stop'], world().deps), 0);
    assert.equal(await main(['init'], world().deps), 1); // fake root without .env.example
    assert.equal(await main(['dev'], world({ states: ['active'] }).deps), 0);
    assert.equal(await main(['admin'], world({ states: ['active'] }).deps), 0);
    assert.equal(await main(['seed'], world({ states: ['active'] }).deps), 0);
    assert.equal(await main(['reset'], world({ answer: RESET_PHRASE }).deps), 0);
    for (const argv of [[], ['nope'], ['reset', '--yes'], ['dev', '--force']]) {
      const { deps, errors } = world();
      assert.equal(await main(argv, deps), 2, argv.join(' '));
      assert.ok(errors().includes(USAGE));
    }
  });
});
