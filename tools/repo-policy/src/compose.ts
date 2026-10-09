/**
 * compose.yaml and compose.dev.yaml rules (ADR-0015, ADR-0016; security-engineer A6, architect W7–W9; RR-03, TM-61;
 * EVM-077 AC8) — instead of Rego.
 */
import { list, record, text } from './files.ts';

/** Bind-mount sources that may be writable: output directories only. */
export const OUTPUT_MOUNTS = ['./coverage/backend-tests', './.scratch/scans'];

/**
 * The two compose files (EVM-077): the gates (compose.yaml, no ports, internal networks only) and the local development
 * environment (compose.dev.yaml: the same hardening, plus narrow exceptions — ports only as 127.0.0.1:<port ≠ 5432>:<port>,
 * networks with egress because an internal network cannot publish ports, and one named volume).
 */
export interface ComposeProfile {
  readonly file: string;
  readonly namedVolumes: readonly string[];
  readonly dev: boolean;
}
export const GATE_PROFILE: ComposeProfile = { file: 'compose.yaml', namedVolumes: ['bt-work'], dev: false };
export const DEV_PROFILE: ComposeProfile = { file: 'compose.dev.yaml', namedVolumes: ['evia-dev-data'], dev: true };

/** The only published port form of compose.dev.yaml: loopback IP, a host port, a container port — no range, no protocol, no other IP. */
const DEV_PORT = /^127\.0\.0\.1:(\d{4,5}):(\d{2,5})$/;
const ROOT_USERS = new Set(['', '0', 'root', '0:0', 'root:root']);
const DIGEST = /^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/;

/**
 * @param document parsed compose file (with YAML merge keys resolved)
 * @param raw the file text (for `${…}` interpolation)
 * @param dockerfile reads `<context>/<name>` (the Dockerfile of a build), null when missing
 */
export function composeProblems(
  document: unknown,
  raw: string,
  dockerfile: (context: string, name: string) => string | null,
  profile: ComposeProfile = GATE_PROFILE,
): string[] {
  const problems: string[] = [];
  const top = record(document);
  const file = profile.file;
  const withoutComments = raw
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  if (withoutComments.includes('${'))
    problems.push(`${file}: interpolacja \${…} jest zabroniona (zmienne hosta zmieniłyby montaże lub obraz)`);
  if ('name' in top) problems.push(`${file}: bez \`name:\` — każdy klon ma własne wolumeny`);
  for (const key of ['include', 'extends']) if (key in top) problems.push(`${file}: zabronione ${key}`);
  const networks = record(top['networks']);
  if (!profile.dev)
    for (const [name, value] of Object.entries(networks))
      if (record(value)['internal'] !== true) problems.push(`${file}: sieć ${name} musi mieć internal: true (bez wyjścia na zewnątrz)`);
  for (const name of Object.keys(record(top['volumes'])))
    if (!profile.namedVolumes.includes(name)) problems.push(`${file}: wolumen ${name} spoza listy dozwolonych`);
  for (const [name, value] of Object.entries(record(top['services']))) {
    const service = record(value);
    const where = `${file}: ${name}`;
    problems.push(...imageProblems(where, service, dockerfile));
    for (const key of ['privileged', 'cap_add', 'devices', 'env_file', 'extends', 'expose', 'volumes_from', 'sysctls'])
      if (key in service) problems.push(`${where}: zabronione ${key}`);
    for (const key of ['pid', 'ipc', 'network_mode', 'userns_mode'])
      if (text(service[key]) === 'host') problems.push(`${where}: zabronione ${key}: host`);
    const securityOpt = list(service['security_opt']).map(text);
    if (securityOpt.some((option) => option.includes('unconfined'))) problems.push(`${where}: security_opt z unconfined`);
    if (!securityOpt.includes('no-new-privileges:true')) problems.push(`${where}: wymagane security_opt no-new-privileges:true`);
    if (service['read_only'] !== true) problems.push(`${where}: wymagane read_only: true`);
    if (!list(service['cap_drop']).includes('ALL')) problems.push(`${where}: wymagane cap_drop: [ALL]`);
    if (ROOT_USERS.has(text(service['user']))) problems.push(`${where}: wymagany użytkownik inny niż root`);
    problems.push(...portProblems(where, list(service['ports']), profile));
    problems.push(...volumeProblems(where, list(service['volumes']).map(String), profile));
    problems.push(...networkProblems(where, name, service, networks, profile));
  }
  return problems;
}

/** Gates: loopback only (and, in a network, no ports at all — see networkProblems). Development: exactly 127.0.0.1:<host port ≠ 5432>:<port>. */
function portProblems(where: string, ports: unknown[], profile: ComposeProfile): string[] {
  return ports.flatMap((entry) => {
    const port = typeof entry === 'string' || typeof entry === 'number' ? String(entry) : null;
    if (!profile.dev)
      return port?.startsWith('127.0.0.1:') === true ? [] : [`${where}: port ${port ?? JSON.stringify(entry)} poza 127.0.0.1`];
    if (port === null) return [`${where}: port w formie rozszerzonej jest zabroniony (tylko 127.0.0.1:<port>:<port>)`];
    const match = DEV_PORT.exec(port);
    if (match === null)
      return [`${where}: port ${port} — dozwolony wyłącznie zapis 127.0.0.1:<port>:<port> (bez zakresów, protokołu i innych adresów)`];
    const host = Number(match[1]);
    if (host === 5432 || host < 1024 || host > 65_535) return [`${where}: port hosta ${host} niedozwolony (poza 1024–65535 albo 5432)`];
    return [];
  });
}

/**
 * EVM-008 (A1, RR-03): in the gates services join only defined (internal) networks and publish no ports there; backend-tests
 * never reaches a network with egress — network_mode none or internal networks only (the default network has egress).
 * The development file (EVM-077) joins its services to defined networks only (networks with egress are its exception).
 */
function networkProblems(
  where: string,
  name: string,
  service: Record<string, unknown>,
  networks: Record<string, unknown>,
  profile: ComposeProfile,
): string[] {
  const value = service['networks'];
  const joined = Array.isArray(value) ? value.map(String) : Object.keys(record(value));
  const problems = joined.filter((network) => !(network in networks)).map((network) => `${where}: sieć ${network} nie jest zdefiniowana`);
  if (profile.dev) {
    if (joined.length === 0) problems.push(`${where}: usługa musi należeć do zdefiniowanej sieci`);
    return problems;
  }
  if (joined.length > 0 && list(service['ports']).length > 0) problems.push(`${where}: usługa w sieci wewnętrznej nie publikuje portów`);
  const offline = text(service['network_mode']) === 'none' || (joined.length > 0 && !('network_mode' in service));
  if (name === 'backend-tests' && !offline) problems.push(`${where}: wymagane network_mode: none albo wyłącznie sieci internal`);
  return problems;
}

function imageProblems(
  where: string,
  service: Record<string, unknown>,
  dockerfile: (context: string, name: string) => string | null,
): string[] {
  const build = service['build'];
  if (build === undefined) return DIGEST.test(text(service['image'])) ? [] : [`${where}: obraz musi mieć tag i digest (@sha256:…)`];
  const context = typeof build === 'string' ? build : text(record(build)['context']);
  const name = typeof build === 'string' ? 'Dockerfile' : text(record(build)['dockerfile']) || 'Dockerfile';
  const path = context === '.' ? name : `${context}/${name}`;
  const content = dockerfile(context, name);
  if (content === null) return [`${where}: brak Dockerfile w ${name === 'Dockerfile' ? context : path}`];
  const froms = content.split('\n').filter((line) => /^\s*FROM\s/i.test(line));
  return froms.length > 0 && froms.every((line) => /@sha256:[0-9a-f]{64}/.test(line))
    ? []
    : [`${where}: każde FROM w ${path} musi mieć digest`];
}

function volumeProblems(where: string, volumes: string[], profile: ComposeProfile): string[] {
  return volumes.flatMap((volume) => {
    const [source = '', , mode = ''] = volume.split(':');
    if (/docker\.sock|docker_engine/.test(volume)) return [`${where}: gniazdo Dockera jest zabronione (${volume})`];
    if (profile.namedVolumes.includes(source)) return [];
    if (!source.startsWith('./'))
      return [
        `${where}: montaż ${volume} spoza listy dozwolonych (tylko ścieżki repozytorium ./… i wolumen ${profile.namedVolumes.join(', ')})`,
      ];
    if (mode !== 'ro' && !OUTPUT_MOUNTS.includes(source)) return [`${where}: montaż ${volume} musi być tylko do odczytu (:ro)`];
    return [];
  });
}

/** W9: Dockerfile of the backend-tests image — digests, nothing downloaded except the exact pnpm, non-root user. */
export function dockerfileProblems(content: string, pnpmVersion: string): string[] {
  const problems: string[] = [];
  const lines = content.split('\n');
  const froms = lines.filter((line) => /^\s*FROM\s/i.test(line));
  if (froms.length === 0 || !froms.every((line) => /:[\w.-]+@sha256:[0-9a-f]{64}/.test(line)))
    problems.push('Dockerfile: każde FROM musi mieć tag i digest');
  if (/\b(apt-get|apt|apk|yum|dnf|curl|wget)\b/.test(content.replace(/^#.*$/gm, '')))
    problems.push('Dockerfile: zabronione pobieranie pakietów systemowych i plików (apt-get, curl, wget …)');
  if (!content.includes('npm install --global "pnpm@${PNPM_VERSION}" --ignore-scripts'))
    problems.push('Dockerfile: pnpm instalowany wyłącznie jako npm install --global "pnpm@${PNPM_VERSION}" --ignore-scripts');
  if (!lines.some((line) => line.trim() === `ARG PNPM_VERSION=${pnpmVersion}`))
    problems.push(`Dockerfile: ARG PNPM_VERSION musi być równe wersji z packageManager (${pnpmVersion})`);
  const user =
    lines
      .filter((line) => /^\s*USER\s/.test(line))
      .at(-1)
      ?.trim()
      .split(/\s+/)[1] ?? '';
  if (ROOT_USERS.has(user)) problems.push('Dockerfile: ostatnie USER musi wskazywać użytkownika innego niż root');
  return problems;
}

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;
const FORBIDDEN_CONTEXT_ENTRY =
  /(^|\/)(\.env[^/]*|\.scratch|\.git|coverage|docs|design|node_modules|dev|\.dev-build|\.claude)(\/|$)|^\*+$|\.pem$|\.key$/;

/**
 * EVM-077 (security-engineer M4; SR-INFRA-05, CWE-538): the API image for the development environment holds no secret and
 * no development tool — no ARG/ENV with a secret-like name, no runtime configuration baked in, installation from the lockfile
 * with scripts disabled, a runtime stage that copies no development directory and asserts in the image that apps/api/dev is
 * absent, and a build context that is an allow-list (nothing of .env*, .scratch, .git, coverage enters).
 */
export function apiDevImageProblems(dockerfileText: string, ignoreText: string): string[] {
  const problems: string[] = [];
  const code = dockerfileText.replace(/^\s*#.*$/gm, '');
  const instructions = code
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim());
  for (const line of instructions.filter((entry) => /^(ENV|ARG)\s/i.test(entry))) {
    const name = line.split(/[\s=]+/)[1] ?? '';
    if (SECRET_NAME.test(name)) problems.push(`api-dev Dockerfile: sekret w ${line.split(/\s+/)[0]} (${name})`);
    if (/^ENV\s/i.test(line) && /^(CURSOR_KEY|DATABASE_URL|NODE_ENV|PANEL_ORIGIN|WEBAUTHN_RP_ID)$/.test(name))
      problems.push(`api-dev Dockerfile: konfiguracja runtime tylko z compose.dev.yaml (${name})`);
  }
  const installs = [...instructions.join('\n').matchAll(/pnpm install([^&\n]*)/g)].map((match) => match[1] ?? '');
  for (const flags of installs)
    if (!flags.includes('--frozen-lockfile') || !flags.includes('--ignore-scripts'))
      problems.push('api-dev Dockerfile: każde pnpm install z --frozen-lockfile i --ignore-scripts');
  if (installs.length === 0) problems.push('api-dev Dockerfile: brak instalacji zależności z lockfile');
  const runtime = code.split(/^FROM\s/im).at(-1) ?? '';
  if (/COPY[^\n]*apps\/api\/(dev|\.dev-build)|COPY\s+(--\S+\s+)*\.\s/.test(runtime))
    problems.push('api-dev Dockerfile: etap runtime kopiuje apps/api/dev, .dev-build albo całe drzewo');
  if (!runtime.includes('test ! -e /app/apps/api/dev'))
    problems.push('api-dev Dockerfile: etap runtime musi sprawdzać w obrazie brak apps/api/dev (RUN test ! -e /app/apps/api/dev …)');
  const entries = ignoreText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (entries[0] !== '*') problems.push('api-dev Dockerfile.dockerignore: pierwszy wpis musi być * (lista dozwolonych)');
  for (const entry of entries.filter((item) => item.startsWith('!')).map((item) => item.slice(1)))
    if (FORBIDDEN_CONTEXT_ENTRY.test(entry)) problems.push(`api-dev Dockerfile.dockerignore: niedozwolony wpis !${entry}`);
  return problems;
}

/**
 * EVM-077 (Konrad 2026-10-09; security-engineer M6; SR-SUPPLY-09, TM-60, TM-61): the only command lines that may start Docker
 * for compose.dev.yaml. `run`, any other `exec`, `-T`, `-u`, `-e`, `--remove-orphans`, `--emergency` and any other file or
 * flag are refused wherever such a line is written (scripts, documentation).
 */
export const DEV_DOCKER_COMMANDS: readonly string[] = Object.freeze([
  'docker compose -f compose.dev.yaml up -d --wait --build',
  'docker compose -f compose.dev.yaml down',
  'docker compose -f compose.dev.yaml down -v',
  'docker compose -f compose.dev.yaml exec api node dist/src/cli/bootstrap-admin.js',
]);

/** The arguments (after `docker`) of the allowed forms — what tools/dev-env/src/docker.mjs must contain, exactly. */
export const DEV_DOCKER_ARGUMENTS: readonly (readonly string[])[] = DEV_DOCKER_COMMANDS.map((command) => command.split(' ').slice(1));

/** @returns the problems of the command lines that mention compose.dev.yaml in `content` (a script, a document) */
export function devDockerCommandProblems(where: string, content: string): string[] {
  const pattern = /docker(?:\.exe)?\s[^\n`|;&]*compose[^\n`|;&]*/g;
  return [...content.matchAll(pattern)].flatMap((match) => {
    const line = match[0]
      .replace(/["')\]]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line.includes('compose.dev.yaml')) return [];
    return DEV_DOCKER_COMMANDS.includes(line)
      ? []
      : [`${where}: Docker dla compose.dev.yaml wyłącznie w jednej z czterech dokładnych form (znaleziono: ${line})`];
  });
}
