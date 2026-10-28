/**
 * Observability on the repository (EVM-085 AC1, AC5, AC6, AC7; architect 4, 5; security-engineer A7, A8, A10, A11, A13): the Alloy
 * service of the infrastructure, the allow-list of log sources, the secrets of the collector, the units of the metrics. The
 * behaviour of the pipeline is tested in a real Alloy (service alloy-tests); here the files cannot drift apart. The code is
 * inactive until the IaC session.
 */
import { describe, expect, it } from 'vitest';
import { json, list, read, record, text, yaml } from '../src/files.ts';

const infra = record(record(yaml('infra/runtime/compose.infra.yaml'))['services']);
const alloy = record(infra['alloy']);
const images = record(record(json('infra/runtime/infra-images.json'))['images']);
const composeYaml = read('compose.yaml');
const strip = (source: string): string => source.replace(/^\s*(\/\/|#).*$/gm, '');
const pipeline = strip(read('infra/observability/alloy/pipeline.alloy'));
const sources = strip(read('infra/observability/alloy/sources.alloy'));
const sinks = strip(read('infra/observability/alloy/sinks.alloy'));

describe('the Alloy service of the infrastructure (EVM-085 AC1; security-engineer A7)', () => {
  it('EVM-085 AC1: the image is tag + digest from infra-images.json and the test service uses the very same image', () => {
    expect(text(alloy['image'])).toBe(text(images['alloy']));
    expect(text(alloy['image'])).toMatch(/^grafana\/alloy:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(composeYaml).toContain(`image: ${text(images['alloy'])}`);
  });

  it('EVM-085 AC1: hardened — non-root, read-only, no capabilities, no new privileges, no ports, no Docker socket', () => {
    expect(text(alloy['user'])).toBe('10020:10020');
    expect(alloy['read_only']).toBe(true);
    expect(alloy['cap_drop']).toEqual(['ALL']);
    expect(alloy['security_opt']).toEqual(['no-new-privileges:true']);
    for (const key of ['ports', 'privileged', 'cap_add', 'devices', 'network_mode', 'pid', 'ipc', 'env_file'])
      expect(alloy[key], key).toBeUndefined();
    const volumes = list(alloy['volumes']).map(text);
    expect(volumes.join(' ')).not.toMatch(/docker\.sock|\/proc|\/sys\b|\/var\/lib\/docker/);
    // every mount of the host is read-only except the journal position directory
    for (const volume of volumes) {
      if (volume.endsWith(':/var/lib/alloy/data')) continue;
      expect(volume, volume).toMatch(/:ro$/);
    }
    expect(volumes).toEqual(
      expect.arrayContaining([
        '/var/log/journal:/var/log/journal:ro',
        '/run/log/journal:/run/log/journal:ro',
        '/etc/machine-id:/etc/machine-id:ro',
        '/run/evia/secrets/alloy:/run/secrets:ro',
      ]),
    );
    expect(text(alloy['command'] === undefined ? '' : list(alloy['command']).join(' '))).toContain(
      '--server.http.listen-addr=127.0.0.1:12345',
    );
  });

  it('EVM-085 AC1: its own network with egress, never evia-runtime (no route to PostgreSQL and the API); the group of the journal is numeric', () => {
    expect(alloy['networks']).toEqual(['evia-telemetry']);
    const networks = record(record(yaml('infra/runtime/compose.infra.yaml'))['networks']);
    expect(record(networks['evia-telemetry'])['internal']).toBeUndefined();
    expect(text(list(alloy['group_add'])[0])).toMatch(/^\$\{EVIA_JOURNAL_GID:\?/);
  });

  it('EVM-085 AC1: no secret in the file; the token only as a file; the manifest gives it to alloy alone', () => {
    const source = read('infra/runtime/compose.infra.yaml');
    expect(source).not.toMatch(/GRAFANA_WRITE_TOKEN:|glc_[A-Za-z0-9]/);
    expect(record(alloy['environment'])['GRAFANA_WRITE_TOKEN_FILE']).toBe('/run/secrets/grafana-write-token');
    const secrets = record(record(json('infra/deploy-agent/secrets.manifest.json'))['services']);
    expect(list(record(secrets['alloy'])['files'])).toEqual(['grafana-write-token']);
    expect(Object.keys(secrets).filter((name) => list(record(secrets[name])['files']).includes('grafana-write-token'))).toEqual(['alloy']);
    expect(record(secrets['alloy'])['uid']).toBe(10020);
  });
});

describe('the sources, the sinks and the pipeline (EVM-085 AC1, AC5; architect 4; security-engineer A8)', () => {
  it('EVM-085 AC1: the token is read by local.file as a secret; the sinks carry env="staging" as an external label; no literal URL or secret', () => {
    expect(sinks).toMatch(/local\.file "grafana_token"[\s\S]*is_secret\s*=\s*true/);
    expect(sinks.match(/external_labels\s*=\s*\{\s*env\s*=\s*"staging"/g)).toHaveLength(2);
    expect(sinks.match(/password\s*=\s*local\.file\.grafana_token\.content/g)).toHaveLength(2);
    expect(sinks).not.toMatch(/https?:\/\/|password\s*=\s*"|bearer_token/);
    expect(pipeline).not.toMatch(/target_label\s*=\s*"env"|env\s*=\s*"/);
  });

  it('EVM-085 AC5: metrics only from the textfile collector (no host /proc or /sys, series limit); no Docker source', () => {
    expect(sources).toMatch(/set_collectors\s*=\s*\["textfile"\]/);
    expect(sources).toMatch(/directory\s*=\s*"\/var\/lib\/evia\/metrics"/);
    expect(sources).not.toMatch(/loki\.source\.docker|docker\.sock|loki\.source\.file|procfs|sysfs/);
  });

  it('EVM-085 AC5: journald fields are mapped to the compose SERVICE and the unit, not to the container name', () => {
    expect(sources).toContain('__journal_com_docker_compose_service');
    expect(sources).toContain('__journal__systemd_unit');
    expect(sources).not.toMatch(/container_name|__journal_container_name/);
  });

  it('EVM-085 AC5: default deny with one anchored keep rule; the dangerous services are not on it', () => {
    const keep = /action\s*=\s*"keep"[\s\S]*?regex\s*=\s*"\(([^"]+)\)"/.exec(pipeline);
    expect(keep).not.toBeNull();
    const allowed = (keep?.[1] ?? '').split('|');
    for (const forbidden of ['postgres', 'clamd', 'freshclam', 'migrate', 'alloy', 'ssh', 'sshd', 'sudo', 'docker'])
      expect(allowed).not.toContain(forbidden);
    expect(allowed).toEqual(expect.arrayContaining(['api', 'worker', 'web', 'caddy', 'evia-deploy-agent']));
    // a regex is anchored by Alloy (the whole value must match); no wildcard that would admit a prefix
    expect(keep?.[1]).not.toMatch(/\.\*|\.\+/);
  });

  it('EVM-085 AC5: Loki labels only from the closed set; the rate limit drops; the redaction stages exist', () => {
    expect(pipeline).toMatch(/label_keep\s*\{\s*values\s*=\s*\["service", "level", "alertCode"\]/);
    expect(pipeline).toMatch(/stage\.limit\s*\{[\s\S]*drop\s*=\s*true/);
    expect(pipeline.match(/stage\.replace/g)?.length).toBeGreaterThanOrEqual(10);
    expect(pipeline.match(/stage\.labels/g)).toHaveLength(2);
  });
});

describe('the metrics units of the agent (EVM-085 AC2; security-engineer A10)', () => {
  it('EVM-085 AC2: a timer every minute starts a root oneshot that cannot raise privileges; the script is the one tested', () => {
    const service = read('infra/deploy-agent/systemd/evia-metrics.service');
    expect(service).toContain('ExecStart=/usr/local/sbin/evia-metrics');
    expect(service).toContain('NoNewPrivileges=true');
    expect(service).toContain('Type=oneshot');
    expect(read('infra/deploy-agent/systemd/evia-metrics.timer')).toContain('OnUnitInactiveSec=60s');
  });
});

describe('the local journal of the VM (EVM-085 AC1; security-engineer A13; architect 4)', () => {
  const userData = read('infra/tofu/modules/vm/templates/user-data.yaml.tftpl');

  it('EVM-085 AC1: Docker logs to journald with the compose labels (no json-file options), and the journal is bounded to 7 days', () => {
    expect(userData).toContain('"log-driver": "journald"');
    expect(userData).toContain('"labels": "com.docker.compose.service,com.docker.compose.project"');
    expect(userData).not.toMatch(/max-size|max-file/);
    expect(userData).toMatch(/Storage=persistent/);
    expect(userData).toMatch(/MaxRetentionSec=7day/);
    expect(userData).toMatch(/SystemMaxUse=\d+[MG]/);
    expect(userData).toMatch(/Compress=yes/);
  });

  it('EVM-085 AC1 (RR-NOC-T3-13): the runbook says that an existing VM does not get the change from user-data', () => {
    const runbook = read('docs/ops/runbooks/alerty.md');
    expect(runbook).toMatch(/ignore_changes/);
    expect(runbook).toMatch(/daemon\.json/);
    expect(runbook).toMatch(/journald\.conf/);
  });
});

describe('the proxy address and the database role of the API (EVM-085 AC6; security-engineer A12; CWE-348)', () => {
  const staging = record(record(yaml('infra/runtime/compose.staging.yaml'))['services']);
  const compose = record(yaml('infra/runtime/compose.infra.yaml'));
  const caddyNetworks = record(record(record(compose['services'])['caddy'])['networks']);
  const subnet = text(record(list(record(record(record(compose['networks'])['evia-runtime'])['ipam'])['config'])[0])['subnet']);
  const address = text(record(caddyNetworks['evia-runtime'])['ipv4_address']);

  it('EVM-085 AC6: TRUSTED_PROXIES of the API and the worker is exactly the fixed address of Caddy, inside the fixed subnet of evia-runtime', () => {
    expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(subnet).toMatch(/\/24$/);
    expect(address.split('.').slice(0, 3).join('.')).toBe(subnet.split('.').slice(0, 3).join('.'));
    for (const name of ['api', 'worker']) {
      const environment = record(record(staging[name] ?? {})['environment']);
      expect(text(environment['TRUSTED_PROXIES']), name).toBe(address);
    }
  });

  it('EVM-085 AC6: no TRUSTED_PROXIES value is a range wider than one address', () => {
    for (const match of read('infra/runtime/compose.staging.yaml').matchAll(/TRUSTED_PROXIES:\s*(\S+)/g)) {
      expect(match[1]).toMatch(/^\d+\.\d+\.\d+\.\d+(\/32)?$/);
    }
  });

  it('EVM-085 AC6: the API logs in as evia_api, a member of the NOLOGIN group evia_app, and owns nothing', () => {
    const roles = read('infra/runtime/postgres-init/10-roles.sql').replace(/^--.*$/gm, '');
    expect(roles).toMatch(/CREATE ROLE evia_app NOLOGIN;/);
    expect(roles).toMatch(/CREATE ROLE evia_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE evia_app;/);
    expect(roles).not.toMatch(/OWNER TO evia_(api|app)/);
    expect(read('infra/deploy-agent/init-secrets.sh')).toContain('postgresql://evia_api:');
  });
});
