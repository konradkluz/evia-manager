/**
 * V4 — the allow-list of the compose file of the channel (EVM-007 AC3; ADR-0018 V4; architect 9, 10; security-engineer
 * A2). Every case of the ADR and every known bypass has its own negative test; the committed file is the positive case.
 */
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { CHANNEL_SERVICES, MAX_COMPOSE_BYTES, parseStrictYaml, validateCompose } from '../src/compose-policy.ts';
import { Rejection } from '../src/errors.ts';
import { COMPOSE } from './support/fixtures.ts';

const IMAGES = { api: `ghcr.io/evia-test/evia-api@sha256:${'a'.repeat(64)}`, web: `ghcr.io/evia-test/evia-web@sha256:${'b'.repeat(64)}` };
const INPUT = { images: IMAGES, network: 'evia-runtime' };

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Rejection) return error.code;
    throw error;
  }
  return 'accepted';
};

type Compose = { services: Record<string, Record<string, unknown>> } & Record<string, unknown>;
const base = (): Compose => parse(COMPOSE) as Compose;
/** The committed file with a change applied, as plain YAML. */
const mutated = (change: (compose: Compose) => void): string => {
  const compose = base();
  change(compose);
  return stringify(compose);
};
const api = (compose: Compose): Record<string, unknown> => compose.services['api'] ?? {};

describe('EVM-007 AC3: the committed compose file of the channel passes V4', () => {
  it('EVM-007 AC3: the canonical document has the digests of the manifest, the runtime network, pull_policy never, and nothing else', () => {
    const canonical = validateCompose(COMPOSE, INPUT);
    const document = JSON.parse(canonical.json) as { services: Record<string, Record<string, unknown>>; networks: unknown };
    expect(Object.keys(document)).toEqual(['services', 'networks']);
    expect(Object.keys(document.services)).toEqual(Object.keys(CHANNEL_SERVICES).sort());
    expect(document.networks).toEqual({ 'evia-runtime': { external: true, name: 'evia-runtime' } });
    for (const [name, service] of Object.entries(document.services)) {
      expect(service['image']).toBe(name === 'web' ? IMAGES.web : IMAGES.api);
      expect(service['pull_policy']).toBe('never');
      expect(service['read_only']).toBe(true);
      expect(service['cap_drop']).toEqual(['ALL']);
      expect(service['networks']).toEqual(['evia-runtime']);
    }
    expect(canonical.sha256).toMatch(/^[0-9a-f]{64}$/);
    // deterministic: the same input gives the same bytes and hash
    expect(validateCompose(COMPOSE, INPUT)).toEqual(canonical);
  });

  it('EVM-007 AC7: the migrator password reaches migrate only; api and worker read the application login; separate numeric users', () => {
    const compose = base();
    const env = (name: string): Record<string, unknown> => (compose.services[name]?.['environment'] ?? {}) as Record<string, unknown>;
    expect(env('migrate')['DATABASE_URL_FILE']).toBe('/run/secrets/database-url-migrator');
    for (const name of ['api', 'worker']) expect(env(name)['DATABASE_URL_FILE']).toBe('/run/secrets/database-url-app');
    expect(COMPOSE.match(/database-url-migrator/g)?.length).toBe(1);
    const users = Object.values(compose.services).map((service) => service['user']);
    expect(new Set(users).size).toBe(users.length);
    for (const [name, service] of Object.entries(compose.services))
      expect(service['volumes'] ?? [`/run/evia/secrets/${name}:/run/secrets:ro`]).toEqual([`/run/evia/secrets/${name}:/run/secrets:ro`]);
  });
});

describe('EVM-007 AC3: V4 rejects the cases of ADR-0018', () => {
  const cases: Array<[string, (compose: Compose) => void, string]> = [
    ['privileged', (c) => (api(c)['privileged'] = true), 'v4-key'],
    ['the Docker socket', (c) => (api(c)['volumes'] = ['/var/run/docker.sock:/var/run/docker.sock']), 'v4-volume'],
    ['a host path outside the allow-list', (c) => (api(c)['volumes'] = ['/etc:/host-etc:ro']), 'v4-volume'],
    ['the secrets of another service', (c) => (api(c)['volumes'] = ['/run/evia/secrets/migrate:/run/secrets:ro']), 'v4-volume'],
    ['network_mode: host', (c) => (api(c)['network_mode'] = 'host'), 'v4-key'],
    ['pid: host', (c) => (api(c)['pid'] = 'host'), 'v4-key'],
    ['ipc: host', (c) => (api(c)['ipc'] = 'host'), 'v4-key'],
    ['uts: host', (c) => (api(c)['uts'] = 'host'), 'v4-key'],
    ['userns_mode: host', (c) => (api(c)['userns_mode'] = 'host'), 'v4-key'],
    ['cgroup: host', (c) => (api(c)['cgroup'] = 'host'), 'v4-key'],
    ['cap_add', (c) => (api(c)['cap_add'] = ['SYS_ADMIN']), 'v4-key'],
    ['devices', (c) => (api(c)['devices'] = ['/dev/sda:/dev/sda']), 'v4-key'],
    ['security_opt seccomp:unconfined', (c) => (api(c)['security_opt'] = ['seccomp:unconfined']), 'v4-hardening'],
    [
      'security_opt apparmor:unconfined next to no-new-privileges',
      (c) => (api(c)['security_opt'] = ['no-new-privileges:true', 'apparmor:unconfined']),
      'v4-hardening',
    ],
    ['build:', (c) => (api(c)['build'] = { context: '.' }), 'v4-key'],
    ['a secret with file:', (c) => (c['secrets'] = { db: { file: '/etc/shadow' } }), 'v4-key'],
    ['a config with file:', (c) => (c['configs'] = { cfg: { file: '/root/.ssh/id_rsa' } }), 'v4-key'],
    ['service secrets', (c) => (api(c)['secrets'] = ['db']), 'v4-key'],
    ['env_file', (c) => (api(c)['env_file'] = ['/etc/evia/secrets/all.env']), 'v4-key'],
    ['an image outside the manifest', (c) => (api(c)['image'] = 'docker.io/library/alpine'), 'v4-image'],
    ['an image by tag', (c) => (api(c)['image'] = 'ghcr.io/evia-test/evia-api:latest'), 'v4-image'],
    ['an image by digest written in the file', (c) => (api(c)['image'] = IMAGES.api), 'v4-image'],
    ['the web image for the api service', (c) => (api(c)['image'] = 'evia-web'), 'v4-image'],
  ];
  for (const [name, change, expected] of cases)
    it(`EVM-007 AC3: ${name} is rejected`, () => {
      expect(code(() => validateCompose(mutated(change), INPUT))).toBe(expected);
    });
});

describe('EVM-007 AC3 (A2, architect 9): V4 rejects the bypasses a deny-list would miss', () => {
  const cases: Array<[string, (compose: Compose) => void, string]> = [
    [
      'top-level volumes with a bind driver (device: /)',
      (c) => (c['volumes'] = { root: { driver_opts: { type: 'none', o: 'bind', device: '/' } } }),
      'v4-key',
    ],
    ['top-level networks external with name host', (c) => (c['networks'] = { h: { external: true, name: 'host' } }), 'v4-key'],
    ['service networks', (c) => (api(c)['networks'] = ['host']), 'v4-key'],
    ['network_mode container:', (c) => (api(c)['network_mode'] = 'container:evia-edge-caddy'), 'v4-key'],
    ['network_mode service:', (c) => (api(c)['network_mode'] = 'service:web'), 'v4-key'],
    ['pid service:', (c) => (api(c)['pid'] = 'service:web'), 'v4-key'],
    ['ipc container:', (c) => (api(c)['ipc'] = 'container:x'), 'v4-key'],
    ['volumes_from', (c) => (api(c)['volumes_from'] = ['web']), 'v4-key'],
    ['ports', (c) => (api(c)['ports'] = ['0.0.0.0:2019:2019']), 'v4-key'],
    ['expose', (c) => (api(c)['expose'] = ['3000']), 'v4-key'],
    ['sysctls', (c) => (api(c)['sysctls'] = { 'net.ipv4.ip_forward': 1 }), 'v4-key'],
    ['extra_hosts', (c) => (api(c)['extra_hosts'] = ['api.github.com:203.0.113.1']), 'v4-key'],
    ['runtime', (c) => (api(c)['runtime'] = 'runc-unsafe'), 'v4-key'],
    ['cgroup_parent', (c) => (api(c)['cgroup_parent'] = '/'), 'v4-key'],
    ['device_cgroup_rules', (c) => (api(c)['device_cgroup_rules'] = ['a *:* rwm']), 'v4-key'],
    ['gpus', (c) => (api(c)['gpus'] = 'all'), 'v4-key'],
    ['group_add', (c) => (api(c)['group_add'] = ['docker']), 'v4-key'],
    ['user root', (c) => (api(c)['user'] = 'root'), 'v4-user'],
    ['user 0', (c) => (api(c)['user'] = '0'), 'v4-user'],
    ['user 0:0', (c) => (api(c)['user'] = '0:0'), 'v4-user'],
    ['user 1000 without a group', (c) => (api(c)['user'] = '1000'), 'v4-user'],
    ['a post_start hook', (c) => (api(c)['post_start'] = [{ command: 'sh', user: 'root', privileged: true }]), 'v4-key'],
    ['a pre_stop hook', (c) => (api(c)['pre_stop'] = [{ command: 'sh' }]), 'v4-key'],
    ['develop', (c) => (api(c)['develop'] = { watch: [{ path: '/', action: 'sync' }] }), 'v4-key'],
    ['profiles', (c) => (api(c)['profiles'] = ['x']), 'v4-key'],
    ['models', (c) => (c['models'] = { m: { model: 'x' } }), 'v4-key'],
    ['include', (c) => (c['include'] = ['https://evil.example/compose.yaml']), 'v4-key'],
    ['extends', (c) => (api(c)['extends'] = { file: '../../x.yaml', service: 'x' }), 'v4-key'],
    ['a provider service', (c) => (api(c)['provider'] = { type: 'model', options: {} }), 'v4-key'],
    ['label_file', (c) => (api(c)['label_file'] = ['/etc/evia/secrets/x']), 'v4-key'],
    ['labels', (c) => (api(c)['labels'] = { a: 'b' }), 'v4-key'],
    ['pull_policy: build', (c) => (api(c)['pull_policy'] = 'build'), 'v4-key'],
    ['a project name', (c) => (c['name'] = 'evia-blue'), 'v4-key'],
    ['an extension field', (c) => (c['x-evil'] = { a: 1 }), 'v4-key'],
    ['secrets with environment', (c) => (c['secrets'] = { s: { environment: 'HCLOUD_TOKEN' } }), 'v4-key'],
    ['entrypoint', (c) => (api(c)['entrypoint'] = ['sh', '-c']), 'v4-key'],
    ['working_dir', (c) => (api(c)['working_dir'] = '/'), 'v4-key'],
    ['healthcheck', (c) => (api(c)['healthcheck'] = { test: ['CMD', 'sh'] }), 'v4-key'],
    ['logging', (c) => (api(c)['logging'] = { driver: 'syslog', options: { 'syslog-address': 'tcp://203.0.113.1:514' } }), 'v4-key'],
    ['read_only false', (c) => (api(c)['read_only'] = false), 'v4-hardening'],
    ['cap_drop of one capability only', (c) => (api(c)['cap_drop'] = ['NET_RAW']), 'v4-hardening'],
    ['no security_opt', (c) => delete api(c)['security_opt'], 'v4-hardening'],
    ['a command with a shell construct', (c) => (api(c)['command'] = ['sh', '-c', 'curl x|sh']), 'v4-command'],
    ['a command that is a string', (c) => (api(c)['command'] = 'dist/src/main.js'), 'v4-command'],
    ['an empty command list', (c) => (api(c)['command'] = []), 'v4-command'],
    ['NODE_OPTIONS in the environment', (c) => (api(c)['environment'] = { NODE_OPTIONS: '--require /tmp/x.js' }), 'v4-environment'],
    [
      'NODE_TLS_REJECT_UNAUTHORIZED in the environment',
      (c) => (api(c)['environment'] = { NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      'v4-environment',
    ],
    ['a proxy variable', (c) => (api(c)['environment'] = { HTTPS_PROXY: 'http://203.0.113.1:3128' }), 'v4-environment'],
    ['LD_PRELOAD', (c) => (api(c)['environment'] = { LD_PRELOAD: '/tmp/x.so' }), 'v4-environment'],
    ['a secret value instead of a file', (c) => (api(c)['environment'] = { DATABASE_URL: 'postgres://u:p@h/d' }), 'v4-environment'],
    ['a key value instead of a file', (c) => (api(c)['environment'] = { CURSOR_KEY: 'x' }), 'v4-environment'],
    ['a lower-case variable name', (c) => (api(c)['environment'] = { path: '/x' }), 'v4-environment'],
    ['a non-string value', (c) => (api(c)['environment'] = { PORT: 3000 }), 'v4-environment'],
    ['an environment list', (c) => (api(c)['environment'] = ['PORT=3000']), 'v4-environment'],
    ['init false', (c) => (api(c)['init'] = false), 'v4-init'],
    ['restart always', (c) => (api(c)['restart'] = 'always'), 'v4-restart'],
    ['a tmpfs outside /tmp', (c) => (api(c)['tmpfs'] = ['/etc']), 'v4-tmpfs'],
    ['a tmpfs with exec', (c) => (api(c)['tmpfs'] = ['/tmp:exec']), 'v4-tmpfs'],
    ['two tmpfs mounts', (c) => (api(c)['tmpfs'] = ['/tmp', '/tmp']), 'v4-tmpfs'],
    ['an unbounded memory limit', (c) => (api(c)['mem_limit'] = '0'), 'v4-limits'],
    ['a pids limit outside 16–4096', (c) => (api(c)['pids_limit'] = -1), 'v4-limits'],
    ['a stop grace period in minutes', (c) => (api(c)['stop_grace_period'] = '5m'), 'v4-limits'],
    ['an extra service', (c) => (c.services['debug'] = { image: 'evia-api' }), 'v4-services'],
    ['a missing service', (c) => delete c.services['worker'], 'v4-services'],
    ['a service that is not a map', (c) => (c.services['api'] = 'evia-api' as unknown as Record<string, unknown>), 'v4-service'],
    ['services that are not a map', (c) => (c['services'] = [] as unknown as Compose['services']), 'v4-schema'],
  ];
  for (const [name, change, expected] of cases)
    it(`EVM-007 AC3: ${name} is rejected`, () => {
      expect(code(() => validateCompose(mutated(change), INPUT))).toBe(expected);
    });
});

describe('EVM-007 AC3 (architect 10): parser differences are rejected before the model is read', () => {
  const cases: Array<[string, string, string]> = [
    ['interpolation', COMPOSE.replace('LOG_LEVEL: info', 'LOG_LEVEL: ${HOME}'), 'v4-interpolation'],
    ['a dollar sign in a comment', `${COMPOSE}\n# $`, 'v4-interpolation'],
    ['an anchor', COMPOSE.replace('  api:\n', '  api: &a\n'), 'v4-yaml'],
    [
      'an alias',
      COMPOSE.replace('    image: evia-web\n', '    image: evia-web\n    x: *a\n').replace('  api:\n', '  api: &a\n'),
      'v4-yaml',
    ],
    ['a merge key', COMPOSE.replace('    image: evia-web\n', '    <<: {privileged: true}\n    image: evia-web\n'), 'v4-yaml'],
    ['a !reset tag', COMPOSE.replace('    cap_drop: [ALL]\n', '    cap_drop: !reset []\n'), 'v4-yaml'],
    ['an !override tag', COMPOSE.replace('    cap_drop: [ALL]\n', '    cap_drop: !override [ALL]\n'), 'v4-yaml'],
    ['a !!binary tag', COMPOSE.replace('    image: evia-web\n', '    image: !!binary ZXZpYS13ZWI=\n'), 'v4-yaml'],
    ['a duplicate key', COMPOSE.replace('    image: evia-web\n', '    image: evia-web\n    image: evia-web\n'), 'v4-yaml'],
    ['a non-scalar key', COMPOSE.replace('    image: evia-web\n', '    image: evia-web\n    ? [a]\n    : b\n'), 'v4-yaml'],
    ['a numeric key', COMPOSE.replace('    image: evia-web\n', '    image: evia-web\n    1: b\n'), 'v4-yaml'],
    ['two documents', `${COMPOSE}\n---\nservices: {}\n`, 'v4-yaml'],
    ['a directive', `%YAML 1.2\n---\n${COMPOSE}`, 'v4-yaml'],
    ['invalid YAML', 'services: [', 'v4-yaml'],
    ['a list at the top level', '- a\n', 'v4-schema'],
    ['a file over the size limit', `${COMPOSE}\n#${'x'.repeat(MAX_COMPOSE_BYTES)}`, 'v4-size'],
  ];
  for (const [name, text, expected] of cases)
    it(`EVM-007 AC3: ${name} is rejected`, () => {
      expect(code(() => validateCompose(text, INPUT))).toBe(expected);
    });

  it('EVM-007 AC3: the strict parser returns plain data for plain YAML', () => {
    expect(parseStrictYaml('a: [1, b]\nc: {d: e}\n')).toEqual({ a: [1, 'b'], c: { d: 'e' } });
  });
});
