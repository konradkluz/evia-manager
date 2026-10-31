/**
 * V4 — the compose file of the channel (EVM-007 AC3; ADR-0018 V4; architect 3, 9, 10; security-engineer A2).
 * An ALLOW-LIST, not a deny-list: exactly the services api, worker, web and migrate, each with a closed set of keys whose
 * values are validated; an unknown key anywhere is a rejection. The channel can therefore never add a port, a network,
 * a host mount, privileges, hooks, a build, an include or a provider — and never change the edge Caddy, TLS or the
 * database (infrastructure of the VM, installed only in an IaC session).
 * Parsing removes the differences between YAML parsers: one document, no anchors, aliases, merge keys, tags or
 * directives, unique scalar keys, no `$` (interpolation would read the environment of root), at most 64 KiB.
 * Root never runs `docker compose` on the file from the repository — only on the canonical JSON built here from the
 * validated model, with the logical image names replaced by the digests of the manifest.
 */
import { isAlias, isMap, isPair, isScalar, isSeq, parseAllDocuments, visit } from 'yaml';
import { Rejection, ensure, isRecord } from './errors.ts';
import { sha256 } from './manifest.ts';

export const MAX_COMPOSE_BYTES = 64 * 1024;
/** The services of the channel and the logical image each one must use. */
export const CHANNEL_SERVICES: Readonly<Record<string, 'evia-api' | 'evia-web'>> = Object.freeze({
  migrate: 'evia-api',
  api: 'evia-api',
  worker: 'evia-api',
  web: 'evia-web',
});

/** The one host directory the worker may mount besides its secrets: the tmpfs it shares with the image processor (EVM-068). */
export const WORKER_MEDIA_WORK = '/run/evia/media-work:/run/media-work';

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Variables that would weaken the runtime (TLS, module loading, proxies) — never settable by the channel. */
const ENV_FORBIDDEN =
  /^(NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_PATH|LD_.*|.*PROXY.*|SSL_.*|UV_.*)$/;
/** A secret is passed as a file (`*_FILE`), never as a value in the compose file. */
const ENV_SECRET = /(PASSWORD|PASSWD|SECRET|TOKEN|KEY|KEYS|CREDENTIALS?|DATABASE_URL|DSN)$/;
const ENV_VALUE = /^[\x20-\x7e]{0,500}$/;
const COMMAND_PART = /^[A-Za-z0-9_./:=-]{1,200}$/;
const USER = /^([1-9][0-9]{3,5}):([1-9][0-9]{3,5})$/;
const TMPFS =
  /^\/tmp(:(size=[0-9]{1,5}[km]|noexec|nosuid|nodev|mode=[0-7]{3,4})(,(size=[0-9]{1,5}[km]|noexec|nosuid|nodev|mode=[0-7]{3,4}))*)?$/;

export interface CanonicalCompose {
  /** The canonical compose document (JSON text) root passes to `docker compose -f`. */
  readonly json: string;
  readonly sha256: string;
}

/** Parses the YAML strictly into plain data (one document, no YAML features beyond maps, sequences and scalars). */
export function parseStrictYaml(text: string): unknown {
  ensure(Buffer.byteLength(text, 'utf8') <= MAX_COMPOSE_BYTES, 'v4-size', `over ${String(MAX_COMPOSE_BYTES)} bytes`);
  ensure(!text.includes('$'), 'v4-interpolation', 'the character $ is not allowed');
  ensure(!/^\s*%/m.test(text), 'v4-yaml', 'directives are not allowed');
  ensure(!text.includes('<<'), 'v4-yaml', 'merge keys are not allowed');
  const documents = parseAllDocuments(text, { uniqueKeys: true, merge: false, schema: 'core', strict: true, prettyErrors: false });
  ensure(Array.isArray(documents) && documents.length === 1, 'v4-yaml', 'exactly one YAML document');
  const [document] = documents;
  ensure(document !== undefined && document.errors.length === 0 && document.warnings.length === 0, 'v4-yaml', 'invalid YAML');
  visit(document, (_key, node) => {
    if (isAlias(node)) throw new Rejection('v4-yaml', 'aliases are not allowed');
    if ((isScalar(node) || isMap(node) || isSeq(node)) && node.anchor !== undefined)
      throw new Rejection('v4-yaml', 'anchors are not allowed');
    if ((isScalar(node) || isMap(node) || isSeq(node)) && node.tag !== undefined) throw new Rejection('v4-yaml', 'tags are not allowed');
    if (isPair(node) && !(isScalar(node.key) && typeof node.key.value === 'string'))
      throw new Rejection('v4-yaml', 'keys must be plain strings');
    return undefined;
  });
  return document.toJS({ maxAliasCount: 0 });
}

const exactly = (value: unknown, expected: unknown): boolean => JSON.stringify(value) === JSON.stringify(expected);

function environment(service: string, value: unknown): Record<string, string> {
  ensure(isRecord(value), 'v4-environment', `${service}: a map of strings`);
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    ensure(ENV_NAME.test(name), 'v4-environment', `${service}: name ${name}`);
    ensure(!ENV_FORBIDDEN.test(name), 'v4-environment', `${service}: ${name} is not allowed`);
    ensure(!ENV_SECRET.test(name), 'v4-environment', `${service}: ${name} looks like a secret — use ${name}_FILE`);
    ensure(typeof item === 'string' && ENV_VALUE.test(item), 'v4-environment', `${service}: ${name} must be a printable string`);
    result[name] = item;
  }
  return result;
}

/** One service: the closed list of keys and the validation of each value (A2, architect 9). */
function service(name: string, value: unknown, image: string): Record<string, unknown> {
  ensure(isRecord(value), 'v4-service', `${name}: a map`);
  const allowed = new Set([
    'image',
    'command',
    'user',
    'read_only',
    'cap_drop',
    'security_opt',
    'init',
    'restart',
    'environment',
    'volumes',
    'tmpfs',
    'mem_limit',
    'pids_limit',
    'stop_grace_period',
  ]);
  for (const key of Object.keys(value)) ensure(allowed.has(key), 'v4-key', `${name}: ${key} is not allowed`);
  ensure(value['image'] === CHANNEL_SERVICES[name], 'v4-image', `${name}: image must be the logical name ${CHANNEL_SERVICES[name] ?? ''}`);
  ensure(value['read_only'] === true, 'v4-hardening', `${name}: read_only: true`);
  ensure(exactly(value['cap_drop'], ['ALL']), 'v4-hardening', `${name}: cap_drop: [ALL]`);
  ensure(exactly(value['security_opt'], ['no-new-privileges:true']), 'v4-hardening', `${name}: security_opt: [no-new-privileges:true]`);
  const user = USER.exec(typeof value['user'] === 'string' ? value['user'] : '');
  ensure(user !== null, 'v4-user', `${name}: a numeric non-root user uid:gid (≥ 1000)`);
  const result: Record<string, unknown> = {
    image,
    pull_policy: 'never',
    user: value['user'],
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
  };
  if ('command' in value) {
    const command = value['command'];
    ensure(Array.isArray(command) && command.length >= 1 && command.length <= 4, 'v4-command', `${name}: a list of 1–4 strings`);
    ensure(
      command.every((part) => typeof part === 'string' && COMMAND_PART.test(part)),
      'v4-command',
      `${name}: command`,
    );
    result['command'] = command;
  }
  if ('init' in value) {
    ensure(value['init'] === true, 'v4-init', `${name}: init: true`);
    result['init'] = true;
  }
  if ('restart' in value) {
    ensure(['no', 'unless-stopped', 'on-failure'].includes(String(value['restart'])), 'v4-restart', `${name}: restart`);
    result['restart'] = value['restart'];
  }
  if ('environment' in value) result['environment'] = environment(name, value['environment']);
  if ('volumes' in value) {
    const secrets = `/run/evia/secrets/${name}:/run/secrets:ro`;
    // EVM-068: the worker alone also gets the work area it shares with the image processor (a tmpfs of the host, mounted in an IaC session)
    const allowed = name === 'worker' ? [[secrets], [secrets, WORKER_MEDIA_WORK]] : [[secrets]];
    ensure(
      allowed.some((candidate) => exactly(value['volumes'], candidate)),
      'v4-volume',
      `${name}: only ${secrets}${name === 'worker' ? ` and, additionally, ${WORKER_MEDIA_WORK}` : ''}`,
    );
    result['volumes'] = value['volumes'];
  }
  if ('tmpfs' in value) {
    const tmpfs = value['tmpfs'];
    ensure(
      Array.isArray(tmpfs) && tmpfs.length === 1 && typeof tmpfs[0] === 'string' && TMPFS.test(tmpfs[0]),
      'v4-tmpfs',
      `${name}: tmpfs`,
    );
    result['tmpfs'] = tmpfs;
  }
  if ('mem_limit' in value) {
    ensure(typeof value['mem_limit'] === 'string' && /^[1-9][0-9]{0,4}[mg]$/.test(value['mem_limit']), 'v4-limits', `${name}: mem_limit`);
    result['mem_limit'] = value['mem_limit'];
  }
  if ('pids_limit' in value) {
    const pids = value['pids_limit'];
    ensure(typeof pids === 'number' && Number.isInteger(pids) && pids >= 16 && pids <= 4096, 'v4-limits', `${name}: pids_limit 16–4096`);
    result['pids_limit'] = pids;
  }
  if ('stop_grace_period' in value) {
    ensure(
      typeof value['stop_grace_period'] === 'string' && /^[1-9][0-9]?s$/.test(value['stop_grace_period']),
      'v4-limits',
      `${name}: stop_grace_period`,
    );
    result['stop_grace_period'] = value['stop_grace_period'];
  }
  return result;
}

export interface ComposeInput {
  readonly images: { readonly api: string; readonly web: string };
  readonly network: string;
}

/** Validates the compose text of the channel and returns the canonical document root may run. */
export function validateCompose(text: string, input: ComposeInput): CanonicalCompose {
  const document = parseStrictYaml(text);
  ensure(isRecord(document), 'v4-schema', 'a map at the top level');
  ensure(exactly(Object.keys(document), ['services']), 'v4-key', 'only `services` at the top level');
  const services = document['services'];
  ensure(isRecord(services), 'v4-schema', 'services must be a map');
  ensure(
    exactly(Object.keys(services).sort(), Object.keys(CHANNEL_SERVICES).sort()),
    'v4-services',
    'exactly api, migrate, web and worker',
  );
  const canonical: Record<string, unknown> = {};
  for (const name of Object.keys(CHANNEL_SERVICES).sort()) {
    const image = CHANNEL_SERVICES[name] === 'evia-web' ? input.images.web : input.images.api;
    canonical[name] = { ...service(name, services[name], image), networks: [input.network] };
  }
  const json = JSON.stringify({ services: canonical, networks: { [input.network]: { external: true, name: input.network } } });
  return { json, sha256: sha256(json) };
}
