/**
 * compose.yaml rules (ADR-0015, ADR-0016; security-engineer A6, architect W7–W9; RR-03, TM-61) — instead of Rego.
 */
import { list, record, text } from './files.ts';

/** Bind-mount sources that may be writable: output directories only. */
export const OUTPUT_MOUNTS = ['./coverage/backend-tests', './.scratch/scans'];
/** Named volumes of the project. */
const NAMED_VOLUMES = ['bt-work'];
const ROOT_USERS = new Set(['', '0', 'root', '0:0', 'root:root']);
const DIGEST = /^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/;

/**
 * @param document parsed compose.yaml (with YAML merge keys resolved)
 * @param raw the file text (for `${…}` interpolation)
 * @param dockerfile reads `<context>/Dockerfile`, null when missing
 */
export function composeProblems(document: unknown, raw: string, dockerfile: (context: string) => string | null): string[] {
  const problems: string[] = [];
  const top = record(document);
  const withoutComments = raw
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  if (withoutComments.includes('${'))
    problems.push('compose.yaml: interpolacja ${…} jest zabroniona (zmienne hosta zmieniłyby montaże lub obraz)');
  if ('name' in top) problems.push('compose.yaml: bez `name:` — każdy klon ma własne wolumeny');
  for (const key of ['include', 'extends']) if (key in top) problems.push(`compose.yaml: zabronione ${key}`);
  const networks = record(top['networks']);
  for (const [name, value] of Object.entries(networks))
    if (record(value)['internal'] !== true) problems.push(`compose.yaml: sieć ${name} musi mieć internal: true (bez wyjścia na zewnątrz)`);
  for (const [name, value] of Object.entries(record(top['services']))) {
    const service = record(value);
    const where = `compose.yaml: ${name}`;
    problems.push(...imageProblems(where, service, dockerfile));
    for (const key of ['privileged', 'cap_add', 'devices', 'env_file', 'extends'])
      if (key in service) problems.push(`${where}: zabronione ${key}`);
    for (const key of ['pid', 'ipc', 'network_mode', 'userns_mode'])
      if (text(service[key]) === 'host') problems.push(`${where}: zabronione ${key}: host`);
    const securityOpt = list(service['security_opt']).map(text);
    if (securityOpt.some((option) => option.includes('unconfined'))) problems.push(`${where}: security_opt z unconfined`);
    if (!securityOpt.includes('no-new-privileges:true')) problems.push(`${where}: wymagane security_opt no-new-privileges:true`);
    if (service['read_only'] !== true) problems.push(`${where}: wymagane read_only: true`);
    if (!list(service['cap_drop']).includes('ALL')) problems.push(`${where}: wymagane cap_drop: [ALL]`);
    if (ROOT_USERS.has(text(service['user']))) problems.push(`${where}: wymagany użytkownik inny niż root`);
    for (const port of list(service['ports']).map(String)) {
      if (!port.startsWith('127.0.0.1:')) problems.push(`${where}: port ${port} poza 127.0.0.1`);
    }
    problems.push(...volumeProblems(where, list(service['volumes']).map(String)));
    problems.push(...networkProblems(name, service, networks));
  }
  return problems;
}

/**
 * EVM-008 (A1, RR-03): services join only defined (internal) networks and publish no ports there; backend-tests never
 * reaches a network with egress — network_mode none or internal networks only (the default network has egress).
 */
function networkProblems(name: string, service: Record<string, unknown>, networks: Record<string, unknown>): string[] {
  const where = `compose.yaml: ${name}`;
  const value = service['networks'];
  const joined = Array.isArray(value) ? value.map(String) : Object.keys(record(value));
  const problems = joined.filter((network) => !(network in networks)).map((network) => `${where}: sieć ${network} nie jest zdefiniowana`);
  if (joined.length > 0 && list(service['ports']).length > 0) problems.push(`${where}: usługa w sieci wewnętrznej nie publikuje portów`);
  const offline = text(service['network_mode']) === 'none' || (joined.length > 0 && !('network_mode' in service));
  if (name === 'backend-tests' && !offline) problems.push(`${where}: wymagane network_mode: none albo wyłącznie sieci internal`);
  return problems;
}

function imageProblems(where: string, service: Record<string, unknown>, dockerfile: (context: string) => string | null): string[] {
  const build = service['build'];
  if (build === undefined) return DIGEST.test(text(service['image'])) ? [] : [`${where}: obraz musi mieć tag i digest (@sha256:…)`];
  const context = typeof build === 'string' ? build : text(record(build)['context']);
  const content = dockerfile(context);
  if (content === null) return [`${where}: brak Dockerfile w ${context}`];
  const froms = content.split('\n').filter((line) => /^\s*FROM\s/i.test(line));
  return froms.length > 0 && froms.every((line) => /@sha256:[0-9a-f]{64}/.test(line))
    ? []
    : [`${where}: każde FROM w ${context}/Dockerfile musi mieć digest`];
}

function volumeProblems(where: string, volumes: string[]): string[] {
  return volumes.flatMap((volume) => {
    const [source = '', , mode = ''] = volume.split(':');
    if (/docker\.sock|docker_engine/.test(volume)) return [`${where}: gniazdo Dockera jest zabronione (${volume})`];
    if (NAMED_VOLUMES.includes(source)) return [];
    if (!source.startsWith('./'))
      return [`${where}: montaż ${volume} spoza listy dozwolonych (tylko ścieżki repozytorium ./… i wolumen bt-work)`];
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
