/**
 * compose.dev.yaml, the API image for it, the exact Docker command lines, the guard parity and the settings of the local
 * environment on the real repository (EVM-077 AC1–AC8; security-engineer M1–M6; SR-INFRA-01, SR-INFRA-05, SR-SUPPLY-09,
 * TM-56, TM-60, TM-61).
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  apiDevImageProblems,
  composeProblems,
  DEV_DOCKER_ARGUMENTS,
  DEV_DOCKER_COMMANDS,
  DEV_PROFILE,
  devDockerCommandProblems,
  dockerfileProblems,
  GATE_PROFILE,
} from '../src/compose.ts';
import { exists, filesBelow, gitIgnores, json, list, read, record, ROOT, staged, text, yaml } from '../src/files.ts';
import { agentPermissionProblems } from '../src/workflows.ts';

const dev = record(yaml('compose.dev.yaml'));
const gates = record(yaml('compose.yaml'));
const services = record(dev['services']);
const service = (name: string): Record<string, unknown> => record(services[name]);
const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)/.exec(String(record(json('package.json'))['packageManager']))?.[1] ?? '';
const reader = (context: string, name: string): string | null => {
  const path = context === '.' ? name : `${context}/${name}`;
  return exists(path) ? read(path) : null;
};
const problemsOf = (document: unknown, raw = ''): string[] => composeProblems(document, raw, reader, DEV_PROFILE);

const DIGEST = 'a'.repeat(64);
const HARDENED = {
  init: true,
  read_only: true,
  cap_drop: ['ALL'],
  security_opt: ['no-new-privileges:true'],
  user: 'node',
  image: `img:1.0@sha256:${DIGEST}`,
  networks: ['n'],
};
/** A minimal valid development file, mutated by the negative cases below. */
const minimal = (service: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): unknown => ({
  services: { a: { ...HARDENED, ...service } },
  networks: { n: {} },
  ...extra,
});

describe('compose.dev.yaml follows the same hardening as compose.yaml (EVM-077 AC8)', () => {
  it('EVM-077 AC8: the real file passes the rules of the profile', () => {
    expect(problemsOf(dev, read('compose.dev.yaml'))).toEqual([]);
    expect(Object.keys(services).sort()).toEqual(['api', 'postgres-dev']);
  });

  it('EVM-077 AC8: the minimal valid file passes, so every negative below fails for its own reason', () => {
    expect(problemsOf(minimal())).toEqual([]);
    expect(problemsOf(minimal({ ports: ['127.0.0.1:5442:5432'] }))).toEqual([]);
    expect(problemsOf(minimal({ volumes: ['evia-dev-data:/data'] }, { volumes: { 'evia-dev-data': {} } }))).toEqual([]);
  });

  it('EVM-077 AC8 (SR-INFRA-01): ports only as 127.0.0.1:<host port other than 5432>:<port> — every other form is refused', () => {
    for (const port of [
      '5442:5432', // no IP: all interfaces
      '0.0.0.0:5442:5432',
      'localhost:5442:5432',
      '[::]:5442:5432',
      '[::1]:5442:5432',
      '127.0.0.1:5442-5450:5432', // range
      '127.0.0.1:5442:5432/udp',
      '127.0.0.1:5432:5432', // the standard PostgreSQL port
      '127.0.0.1:80:3000', // privileged host port
      '127.0.0.1::5432', // random host port
      '192.168.1.5:5442:5432',
      '127.0.0.2:5442:5432',
      '5442',
    ])
      expect(problemsOf(minimal({ ports: [port] })).join('\n'), port).toMatch(/port/);
    expect(problemsOf(minimal({ ports: [{ target: 5432, published: 5442, host_ip: '0.0.0.0' }] })).join('\n')).toContain(
      'formie rozszerzonej',
    );
    expect(problemsOf(minimal({ expose: ['5432'] })).join('\n')).toContain('zabronione expose');
  });

  it('EVM-077 AC8: the remaining hardening is required — pinned image, read-only, no capabilities, non-root, no env_file, no socket', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ image: 'img:1.0' }, 'tag i digest'],
      [{ read_only: false }, 'read_only: true'],
      [{ cap_drop: [] }, 'cap_drop: [ALL]'],
      [{ security_opt: [] }, 'no-new-privileges'],
      [{ user: 'root' }, 'użytkownik inny niż root'],
      [{ user: undefined }, 'użytkownik inny niż root'],
      [{ privileged: true }, 'zabronione privileged'],
      [{ cap_add: ['NET_ADMIN'] }, 'zabronione cap_add'],
      [{ env_file: ['.env'] }, 'zabronione env_file'],
      [{ pid: 'host' }, 'zabronione pid: host'],
      [{ network_mode: 'host', networks: ['n'] }, 'network_mode: host'],
      [{ volumes: ['/var/run/docker.sock:/var/run/docker.sock'] }, 'gniazdo Dockera'],
      [{ volumes: ['./infra:/data'] }, 'tylko do odczytu'],
      [{ volumes: ['/etc:/etc:ro'] }, 'spoza listy dozwolonych'],
      [{ volumes: ['bt-work:/work'] }, 'spoza listy dozwolonych'],
      [{ networks: [] }, 'musi należeć do zdefiniowanej sieci'],
      [{ networks: ['missing'] }, 'sieć missing nie jest zdefiniowana'],
    ];
    for (const [override, fragment] of cases) {
      const document = minimal(override);
      expect(problemsOf(document).join('\n'), JSON.stringify(override)).toContain(fragment);
    }
    expect(problemsOf(minimal({ environment: { A: '${HOME}' } }), 'environment:\n  A: ${HOME}').join('\n')).toContain('interpolacja');
    expect(problemsOf({ ...(minimal() as object), name: 'evia' }).join('\n')).toContain('bez `name:`');
    expect(problemsOf(minimal({}, { volumes: { 'other-volume': {} } })).join('\n')).toContain('wolumen other-volume spoza listy');
    expect(problemsOf(minimal({ build: { context: '.', dockerfile: 'missing/Dockerfile' } })).join('\n')).toContain('brak Dockerfile');
  });

  it('EVM-077 AC8: the exception for networks is the development file only — the gates keep internal networks and no ports', () => {
    expect(composeProblems(minimal(), '', reader, GATE_PROFILE).join('\n')).toContain('musi mieć internal: true');
    expect(composeProblems(gates, read('compose.yaml'), reader).filter((problem) => problem.startsWith('compose.yaml'))).toEqual([]);
    expect(Object.keys(record(gates['networks']))).toEqual(['backend-db']);
    expect(
      composeProblems(minimal({ ports: ['127.0.0.1:5442:5432'] }, { networks: { n: { internal: true } } }), '', reader, GATE_PROFILE).join(
        '\n',
      ),
    ).toContain('nie publikuje portów');
  });

  it('EVM-077 AC3 (M1): names of services, networks and volumes are disjoint from compose.yaml, and neither file sets `name:`', () => {
    const names = (document: Record<string, unknown>, key: string): string[] => Object.keys(record(document[key]));
    for (const key of ['services', 'networks', 'volumes']) {
      const shared = names(dev, key).filter((name) => names(gates, key).includes(name));
      expect(shared, key).toEqual([]);
    }
    expect('name' in dev || 'name' in gates).toBe(false);
    // `down -v` of this file removes this file's volume only: bt-work, the gates' containers and network are not in it
    expect(names(dev, 'volumes')).toEqual(['evia-dev-data']);
    expect(names(dev, 'networks')).toEqual(['dev-net']);
    for (const mounts of Object.values(services).map((value) => list(record(value)['volumes']).map(String)))
      for (const mount of mounts) expect(mount.startsWith('bt-work')).toBe(false);
  });

  it('EVM-077 AC4 (M3): the api service has every setting written out — only CURSOR_KEY is taken from the host, by name', () => {
    const api = service('api');
    const environment = record(api['environment']);
    expect(environment).toEqual({
      NODE_ENV: 'development',
      API_PORT: '3000',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgres://evia:evia-local@postgres-dev:5432/evia_dev',
      MIN_SUPPORTED_APP_VERSION_ANDROID: '1.0.0',
      MIN_SUPPORTED_APP_VERSION_IOS: '1.0.0',
      PANEL_ORIGIN: 'http://localhost:5173',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_RP_NAME: 'EVia Manager',
      CURSOR_KEY: null,
    });
    expect(read('compose.dev.yaml').replace(/#.*$/gm, '')).not.toContain('${');
    expect(api['env_file']).toBeUndefined();
    expect(api['ports']).toEqual(['127.0.0.1:3000:3000']);
    expect(record(record(api['depends_on'])['postgres-dev'])['condition']).toBe('service_healthy');
    expect(api['user']).toBe('node');
  });

  it('EVM-077 AC4: postgres-dev uses the image and initdb arguments of compose.yaml, mounts the marker read-only and is published on loopback only', () => {
    const postgres = service('postgres-dev');
    const reference = record(record(gates['services'])['postgres']);
    expect(postgres['image']).toBe(reference['image']);
    expect(record(postgres['environment'])['POSTGRES_INITDB_ARGS']).toBe(record(reference['environment'])['POSTGRES_INITDB_ARGS']);
    expect(record(postgres['environment'])['POSTGRES_DB']).toBe('evia_dev');
    expect(postgres['user']).toBe('999:999');
    expect(postgres['ports']).toEqual(['127.0.0.1:5442:5432']);
    expect(list(postgres['volumes']).map(String)).toEqual([
      'evia-dev-data:/var/lib/postgresql',
      './infra/docker/postgres-dev/init.sql:/docker-entrypoint-initdb.d/10-evia-env.sql:ro',
    ]);
    expect(list(record(postgres['healthcheck'])['test'])).toContain('--dbname=evia_dev');
  });

  it('EVM-077 AC4 (M2): the marker is set by the initialisation script on the database itself, and the guard reads the same setting', () => {
    const initSql = read('infra/docker/postgres-dev/init.sql')
      .split('\n')
      .filter((line) => !line.startsWith('--') && line.trim() !== '');
    expect(initSql).toEqual(["ALTER DATABASE evia_dev SET evia.env = 'local-dev';"]);
    const guard = read('apps/api/dev/guard.ts');
    expect(guard).toContain("MARKER = 'evia.env=local-dev'");
    expect(read('apps/api/dev/database-facts.ts')).toContain('pg_db_role_setting');
    expect(read('apps/api/dev/database-facts.ts')).toContain('s.setrole = 0');
    expect(read('apps/api/dev/database-facts.ts')).not.toContain('current_setting');
  });
});

describe('the API image of the development environment (EVM-077 AC7, AC8; M4; SR-INFRA-05, CWE-538)', () => {
  const dockerfile = read('infra/docker/api-dev/Dockerfile');
  const ignore = read('infra/docker/api-dev/Dockerfile.dockerignore');

  it('EVM-077 AC8: the Dockerfile is pinned by digest, installs exact pnpm, downloads nothing else and runs as non-root', () => {
    expect(dockerfileProblems(dockerfile, pnpmVersion)).toEqual([]);
    expect(apiDevImageProblems(dockerfile, ignore)).toEqual([]);
    const build = record(service('api')['build']);
    expect(build).toEqual({ context: '.', dockerfile: 'infra/docker/api-dev/Dockerfile' });
  });

  it('EVM-077 AC7 (M4): the runtime stage copies built output only and the build asserts that apps/api/dev is not in the image', () => {
    expect(dockerfile).toContain('RUN test ! -e /app/apps/api/dev');
    const runtime = dockerfile.split(/^FROM /m).at(-1) ?? '';
    for (const copy of runtime.match(/^COPY .*$/gm) ?? []) expect(copy).not.toMatch(/apps\/api\/dev|\.dev-build|apps\/api\/src/);
    expect(runtime.match(/^COPY /gm)?.length).toBeGreaterThan(5);
    for (const copy of runtime.match(/^COPY .*$/gm) ?? []) expect(copy).toMatch(/--from=build/);
    const apiBuild = record(json('apps/api/tsconfig.build.json'));
    expect(list(apiBuild['include'])).toEqual(['src/**/*.ts']);
    expect(read('apps/api/tsconfig.dev.json')).toContain('"outDir": ".dev-build"');
    expect(gitIgnores('apps/api/.dev-build/dev/cli.js')).toBe(true);
    const dist = 'apps/api/dist';
    if (exists(dist)) expect(filesBelow(dist, (path) => /\/dev\/|nest-seed|seed\/run|\.dev-build/.test(path)).length).toBe(0);
  });

  it('EVM-077 AC1 (M4, TM-56): the build context is an allow-list that never lets .env*, .scratch, .git, coverage or docs in', () => {
    const entries = ignore.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
    expect(entries[0]).toBe('*');
    expect(apiDevImageProblems(dockerfile, '*\n!.env\n')).toContain('api-dev Dockerfile.dockerignore: niedozwolony wpis !.env');
    for (const forbidden of ['.env.local', '.scratch', '.git', 'coverage', 'docs', 'apps/api/dev', 'node_modules', '.claude'])
      expect(apiDevImageProblems(dockerfile, `*\n!${forbidden}\n`).join('\n'), forbidden).toContain(`!${forbidden}`);
    expect(apiDevImageProblems(dockerfile, '!package.json\n').join('\n')).toContain('pierwszy wpis musi być *');
  });

  it('EVM-077 AC1 (M4): no secret or runtime configuration in ARG/ENV, installation only from the lockfile without scripts', () => {
    const base = dockerfile;
    const bad = (extra: string): string[] => apiDevImageProblems(`${base}\n${extra}\n`, '*\n');
    expect(bad('ARG CURSOR_KEY=x').join('\n')).toContain('sekret w ARG');
    expect(bad('ENV API_TOKEN=x').join('\n')).toContain('sekret w ENV');
    expect(bad('ENV DATABASE_URL=postgres://x').join('\n')).toContain('konfiguracja runtime');
    expect(bad('ENV NODE_ENV=development').join('\n')).toContain('konfiguracja runtime');
    expect(apiDevImageProblems(base.replace(/--frozen-lockfile/g, ''), '*\n').join('\n')).toContain('--frozen-lockfile');
    expect(apiDevImageProblems(base.replace(/--ignore-scripts(\s+--filter)/g, '$1'), '*\n').join('\n')).toContain('--ignore-scripts');
    expect(apiDevImageProblems('FROM node:26@sha256:' + DIGEST + '\n', '*\n').join('\n')).toContain('brak instalacji');
    expect(apiDevImageProblems(`${base}\nFROM x@sha256:${DIGEST}\nCOPY . .\n`, '*\n').join('\n')).toContain('kopiuje');
    expect(apiDevImageProblems(base.replace('RUN test ! -e /app/apps/api/dev', 'RUN true'), '*\n').join('\n')).toContain(
      'brak apps/api/dev',
    );
  });
});

describe('Docker only through four exact command lines (EVM-077 AC8; Konrad 2026-10-09; M6; TM-60, TM-61)', () => {
  it('EVM-077 AC8: tools/dev-env/src/docker.mjs holds exactly the four argument lists', async () => {
    const module = (await import(pathToFileURL(`${ROOT}tools/dev-env/src/docker.mjs`).href)) as { COMMANDS: Record<string, string[]> };
    expect(Object.values(module.COMMANDS).map((args) => [...args])).toEqual(DEV_DOCKER_ARGUMENTS.map((args) => [...args]));
    expect(Object.keys(module.COMMANDS)).toEqual(['up', 'down', 'downVolumes', 'adminExec']);
    expect(DEV_DOCKER_COMMANDS).toHaveLength(4);
  });

  it('EVM-077 AC8: the allowed lines are accepted and every other form is rejected — run, other exec, -T, -u, -e, --remove-orphans, another file', () => {
    for (const command of DEV_DOCKER_COMMANDS) expect(devDockerCommandProblems('t', `x\n${command}\ny`), command).toEqual([]);
    for (const command of DEV_DOCKER_COMMANDS) expect(devDockerCommandProblems('t', `run \`${command}\` now`), command).toEqual([]);
    const rejected = [
      'docker compose -f compose.dev.yaml run --rm api sh',
      'docker compose -f compose.dev.yaml run api node dist/src/cli/bootstrap-admin.js',
      'docker compose -f compose.dev.yaml exec api sh',
      'docker compose -f compose.dev.yaml exec api node dist/src/main.js',
      'docker compose -f compose.dev.yaml exec -T api node dist/src/cli/bootstrap-admin.js',
      'docker compose -f compose.dev.yaml exec -u root api node dist/src/cli/bootstrap-admin.js',
      'docker compose -f compose.dev.yaml exec -e A=1 api node dist/src/cli/bootstrap-admin.js',
      'docker compose -f compose.dev.yaml exec api node dist/src/cli/bootstrap-admin.js --emergency --reason lost_access',
      'docker compose -f compose.dev.yaml exec postgres-dev psql',
      'docker compose -f compose.dev.yaml down --remove-orphans',
      'docker compose -f compose.dev.yaml down -v --remove-orphans',
      'docker compose -f compose.dev.yaml down --volumes',
      'docker compose -f compose.dev.yaml up',
      'docker compose -f compose.dev.yaml up -d',
      'docker compose -f compose.dev.yaml up -d --wait',
      'docker compose -f compose.dev.yaml cp api:/etc/passwd .',
      'docker compose -p other -f compose.dev.yaml down',
      'docker compose --file compose.dev.yaml down',
      'docker compose -f compose.dev.yaml -f compose.yaml down',
      'docker.exe compose -f compose.dev.yaml run api sh',
    ];
    for (const command of rejected) expect(devDockerCommandProblems('t', command).length, command).toBe(1);
    // other files are the business of the gates' rules, not these
    expect(devDockerCommandProblems('t', 'docker compose -f compose.yaml run --rm backend-tests')).toEqual([]);
  });

  it('EVM-077 AC8: no script, workflow, hook or document writes a Docker line for compose.dev.yaml outside the four forms', () => {
    const files = [
      'package.json',
      'lefthook.yml',
      'README.md',
      'CLAUDE.md',
      'apps/api/README.md',
      ...filesBelow('.github', (path) => /\.ya?ml$/.test(path)),
      ...filesBelow('tools', (path) => /\.(mjs|ts|md)$/.test(path) && !path.includes('/test/') && !path.startsWith('tools/repo-policy/')),
      ...filesBelow('docs/ops', (path) => path.endsWith('.md')),
    ].filter(exists);
    for (const file of files) expect(devDockerCommandProblems(file, read(file)), file).toEqual([]);
  });

  it('EVM-077 AC3, AC8: package.json scripts call the CLI directly (no turbo, no pipes, no --yes) and `dev` is not a turbo task', () => {
    const scripts = record(record(json('package.json'))['scripts']);
    expect(scripts['dev']).toBe('node tools/dev-env/cli.mjs dev');
    for (const [name, command] of [
      ['dev:init', 'init'],
      ['dev:admin', 'admin'],
      ['dev:seed', 'seed'],
      ['dev:stop', 'stop'],
      ['dev:reset', 'reset'],
    ] as const)
      expect(scripts[name], name).toBe(`node tools/dev-env/cli.mjs ${command}`);
    for (const [name, command] of Object.entries(scripts))
      if (name.startsWith('dev')) expect(text(command), name).not.toMatch(/turbo|--yes|\||>|tee|docker/);
  });

  it('EVM-077 AC5 (M5): the terminal command inherits the terminal — the link reaches no file, pipe or log of the tooling', () => {
    const docker = read('tools/dev-env/src/docker.mjs');
    expect(docker).toContain("stdio: capture ? ['ignore', 'inherit', 'pipe'] : 'inherit'");
    expect(docker).toContain("const capture = name === 'up';");
    const sources = filesBelow('tools/dev-env', (path) => /\.mjs$/.test(path) && !path.includes('/test/'))
      .map(read)
      .join('\n');
    expect(sources).not.toMatch(/createWriteStream|appendFile|writeFileSync\([^)]*(log|scratch)|\.scratch|tee\b/);
    expect(read('tools/dev-env/src/commands.mjs')).toContain('!deps.stdinIsTTY || !deps.stdoutIsTTY');
  });
});

describe('agent permissions and secrets of the local environment (EVM-077 AC1; M6; SR-INFRA-05)', () => {
  const names = Object.keys(record(gates['services']));
  const settings = (): Record<string, unknown> => JSON.parse(staged('.claude/settings.json')) as Record<string, unknown>;

  it('EVM-077 M6: deleting the dev data asks first, run/exec on the dev file are denied, and nothing allows the dev file or dev commands', () => {
    expect(agentPermissionProblems(settings(), names)).toEqual([]);
    const permissions = record(settings()['permissions']);
    const allow = list(permissions['allow']).map(String);
    expect(allow.filter((rule) => /dev/.test(rule))).toEqual([]);
    const without = (kind: string, rule: string): unknown => ({
      permissions: { ...permissions, [kind]: list(permissions[kind]).filter((entry) => entry !== rule) },
    });
    expect(agentPermissionProblems(without('ask', 'Bash(pnpm run dev:reset:*)'), names).join('\n')).toContain(
      'brak reguły ask Bash(pnpm run dev:reset:*)',
    );
    expect(agentPermissionProblems(without('ask', 'Bash(docker compose -f compose.dev.yaml down -v:*)'), names)).toHaveLength(1);
    expect(agentPermissionProblems(without('deny', 'Bash(docker compose -f compose.dev.yaml exec:*)'), names)).toHaveLength(1);
    for (const rule of [
      'Bash(docker compose -f compose.dev.yaml up -d --wait --build)',
      'Bash(pnpm run dev)',
      'Bash(pnpm run dev:reset)',
      'Bash(node tools/dev-env/cli.mjs dev)',
    ]) {
      const withAllow = { permissions: { ...permissions, allow: [...allow, rule] } };
      expect(agentPermissionProblems(withAllow, names).length, rule).toBeGreaterThan(0);
    }
  });

  it('EVM-077 AC1: .env is ignored by git, .env.example holds no secret, a cursor key that is empty and a database URL of the dev database', () => {
    expect(gitIgnores('.env')).toBe(true);
    expect(gitIgnores('.env.example')).toBe(false);
    const example = read('.env.example');
    expect(example).toMatch(/^CURSOR_KEY=$/m);
    expect(example).toMatch(/^DATABASE_URL=postgres:\/\/evia:evia-local@localhost:5442\/evia_dev$/m);
    expect(example).toMatch(/^NODE_ENV=development$/m);
    expect(example).toMatch(/^WEBAUTHN_RP_ID=localhost$/m);
    expect(example).toMatch(/^PANEL_ORIGIN=http:\/\/localhost:5173$/m);
  });

  it('EVM-077 AC1: dev:init writes with the flag wx and never prints the key', () => {
    const source = read('tools/dev-env/src/env-file.mjs');
    expect(source).toContain("flag: 'wx'");
    expect(source).toContain('randomBytes');
    expect(source).not.toMatch(/console\.|stdout|stderr/);
    expect(read('tools/dev-env/src/commands.mjs')).not.toMatch(/CURSOR_KEY\s*[}\])]|\$\{[^}]*key/i);
  });
});

describe('the panel and the API of the local environment (EVM-077 AC2, AC6)', () => {
  it('EVM-077 AC6: Vite listens on loopback only and proxies only to 127.0.0.1:API_PORT without rewriting the origin', () => {
    const config = read('apps/web/vite.config.ts').replace(/^\s*\/\/.*$/gm, '');
    expect(config).toContain("server: { host: '127.0.0.1'");
    expect(config).toContain("preview: { host: '127.0.0.1'");
    expect(config).not.toMatch(/host:\s*(true|'0\.0\.0\.0'|'::'|"0\.0\.0\.0")/);
    expect(config).not.toContain('allowedHosts');
    expect(config).not.toContain('--host');
    expect(config).toContain("target: `http://127.0.0.1:${process.env['API_PORT'] ?? '3000'}`");
    expect(config).toContain('changeOrigin: false');
    expect(config).toContain("proxy: { '/api': api }");
  });

  it('EVM-077 AC6: nothing in the API source depends on NODE_ENV except the configuration — cookies, CSRF and RP ID have no development switch', () => {
    const users = filesBelow('apps/api/src', (path) => /\.ts$/.test(path)).filter((path) => /\bnodeEnv\b|NODE_ENV/.test(read(path)));
    expect(users).toEqual(['apps/api/src/platform/config/config.ts']);
    expect(read('apps/api/src/modules/identity/domain/constants.ts')).toContain('__Host-');
  });

  it('EVM-077 AC7: no code of the production source reaches the seed or builds a principal for it', () => {
    const sources = filesBelow('apps/api/src', (path) => /\.ts$/.test(path));
    for (const path of sources) {
      const content = read(path);
      expect(content, path).not.toMatch(/apps\/api\/dev|from '\.\.\/(\.\.\/)*dev\/|seedPrincipal|principalFor\(|seedDemoData/);
    }
    expect(read('.dependency-cruiser.cjs')).toContain("name: 'api-src-not-to-dev'");
  });

  it('EVM-077 AC7: the seed leaves the API without a new route — no seed or setup operation in the contract', () => {
    const openapi = filesBelow('packages/contracts/openapi', (path) => /\.ya?ml$/.test(path))
      .map(read)
      .join('\n');
    expect(openapi).not.toMatch(/\/(seed|setup|demo)\b|operationId:\s*(seed|setup|demo)/i);
  });
});

describe('the guard has one specification in two implementations (EVM-077 AC4)', () => {
  const CASES: Array<Record<string, string | undefined>> = [
    {},
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev' },
    { NODE_ENV: 'production', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'evia.example', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev?host=db.example' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev?hostaddr=10.0.0.1' },
    {
      NODE_ENV: 'development',
      WEBAUTHN_RP_ID: 'localhost',
      DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev?options=-c%20evia.env%3Dlocal-dev',
    },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@db.example.com:5442/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost,db.example:5442/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5432/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/%65via_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@postgres-dev:5432/evia_dev' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@[::1]:5442/evia_dev' },
    {
      NODE_ENV: 'development',
      WEBAUTHN_RP_ID: 'localhost',
      DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev',
      PGHOST: 'db.example',
    },
    {
      NODE_ENV: 'development',
      WEBAUTHN_RP_ID: 'localhost',
      DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev',
      PGOPTIONS: '-c evia.env=local-dev',
    },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'postgres://evia:x@localhost:5442/evia_dev', API_PORT: '3001' },
    { NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', DATABASE_URL: 'nonsense' },
  ];

  it('EVM-077 AC4: tools/dev-env/src/guard.mjs and apps/api/dev/guard.ts give the same verdict (codes and messages) on every case', async () => {
    const tool = (await import(pathToFileURL(`${ROOT}tools/dev-env/src/guard.mjs`).href)) as {
      guardProblems(env: Record<string, string | undefined>): Array<{ code: string; message: string }>;
    };
    const api = (await import(pathToFileURL(`${ROOT}apps/api/dev/guard.ts`).href)) as {
      environmentProblems(env: Record<string, string | undefined>): Array<{ code: string; message: string }>;
    };
    for (const env of CASES) expect(api.environmentProblems(env), JSON.stringify(env)).toEqual(tool.guardProblems(env));
    expect(CASES.filter((env) => tool.guardProblems(env).length === 0)).toHaveLength(3);
  });
});
