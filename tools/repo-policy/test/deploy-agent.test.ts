/**
 * The deployment verifier as a sensitive, self-contained workspace (EVM-007 AC3; ADR-0018 m5, K3; architect 1, 2).
 */
import { describe, expect, it } from 'vitest';
import { filesBelow, json, list, read, record, text, yaml } from '../src/files.ts';

describe('services/deploy-agent (EVM-007 AC3)', () => {
  it('EVM-007 AC3 (architect 1): the verifier imports nothing of apps, packages or tools, and nothing imports it', () => {
    const config = read('.dependency-cruiser.cjs');
    expect(config).toContain("name: 'deploy-agent-self-contained'");
    expect(config).toContain("from: { path: '^services/deploy-agent/(src|test)/' }");
    expect(config).toContain("to: { path: '^(apps|packages|tools|services/(?!deploy-agent/))' }");
    expect(config).toContain("name: 'nothing-imports-deploy-agent'");
    const pkg = record(json('services/deploy-agent/package.json'));
    expect(Object.keys(record(pkg['dependencies']))).toEqual(['yaml']);
    expect(text(record(pkg['scripts'])['test:coverage'])).toBe('vitest run --coverage');
    expect(read('services/deploy-agent/vitest.config.ts')).toContain("coverage({ layer: 'shared'");
  });

  it('EVM-007 AC3 (K3, architect 2): services/deploy-agent and infra are sensitive files — CODEOWNERS and the K3 summary of CI', () => {
    expect(read('.github/CODEOWNERS')).toContain('/services/deploy-agent/ @konradkluz');
    expect(read('.github/CODEOWNERS')).toContain('/infra/                @konradkluz');
    const security = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['security']);
    const k3 = list(security['steps'])
      .map(record)
      .find((step) => text(step['name']).includes('(K3)'));
    expect(text(k3?.['run'])).toContain('infra services/deploy-agent');
  });

  it('EVM-007 AC6 (security-engineer, Low): tools/staging-verify (bramka 10 on staging) is a sensitive file — CODEOWNERS, the K3 summary of CI and docs/ops', () => {
    expect(read('.github/CODEOWNERS')).toMatch(/^\/tools\/staging-verify\/ +@konradkluz\r?$/m);
    const security = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['security']);
    const k3 = list(security['steps'])
      .map(record)
      .find((step) => text(step['name']).includes('(K3)'));
    expect(text(k3?.['run'])).toContain('infra services/deploy-agent tools/staging-verify');
    expect(read('docs/ops/github-i-ci.md')).toContain('`tools/staging-verify/**`');
    expect(read('.github/pull_request_template.md')).toContain('`tools/staging-verify/**`');
  });

  it('EVM-007 AC3: the coverage reports of services/* reach changed-code coverage in CI', () => {
    const quality = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['quality']);
    const upload = list(quality['steps'])
      .map(record)
      .find((step) => record(step['with'])['name'] === 'lcov-quality');
    expect(text(record(upload?.['with'])['path'])).toContain('services/*/coverage/lcov.info');
  });
});

describe('the VM side of the channel (EVM-007 AC1, AC4, AC7; architect 3, 12–14; security-engineer A6, B)', () => {
  const channel = record(record(yaml('infra/runtime/compose.staging.yaml'))['services']);
  const secrets = record(record(json('infra/deploy-agent/secrets.manifest.json'))['services']);

  it('EVM-007 AC7: every service of the channel has its own numeric user; the secrets manifest uses the same UIDs; the migrator password goes to migrate only', () => {
    const users = Object.values(channel).map((service) => text(record(service)['user']));
    expect(new Set(users).size).toBe(users.length);
    const infra = {
      ...record(record(yaml('infra/runtime/compose.infra.yaml'))['services']),
      ...record(record(yaml('infra/runtime/compose.telemetry.yaml'))['services']),
    };
    for (const [name, value] of Object.entries(secrets)) {
      const uid = String(record(value)['uid']);
      expect(text(record(channel[name] ?? infra[name])['user']), name).toBe(`${uid}:${uid}`);
    }
    // PostgreSQL (compose.infra.yaml) gets only its superuser password; no service of the channel gets it.
    expect(list(record(secrets['postgres'])['files'])).toEqual([
      'postgres-password',
      'pgbackrest-cipher-pass',
      'backup-s3-secret-access-key',
    ]);
    expect(Object.keys(secrets).filter((name) => list(record(secrets[name])['files']).includes('postgres-password'))).toEqual(['postgres']);
    const holders = Object.entries(secrets)
      .filter(([, value]) => list(record(value)['files']).includes('database-url-migrator'))
      .map(([name]) => name);
    expect(holders).toEqual(['migrate']);
    for (const name of ['api', 'worker']) expect(list(record(secrets[name])['files'])).toContain('database-url-app');
  });

  it('EVM-007 AC7 (SR-INFRA-05): after a reboot the secrets are restored before Docker, fail-closed, by the same script as deploy.sh', () => {
    const unit = read('infra/deploy-agent/systemd/evia-secrets.service');
    expect(unit).toContain('Before=docker.service');
    expect(unit).toContain('RequiredBy=docker.service');
    expect(unit).toContain('Type=oneshot');
    expect(unit).toContain('ExecStart=/usr/local/sbin/evia-secrets');
    expect(unit).toContain('OnFailure=evia-deploy-agent-alert.service');
    expect(read('infra/deploy-agent/deploy.sh')).toContain('"$ROOT/usr/local/sbin/evia-secrets" "$manifest_sha"');
    const script = read('infra/deploy-agent/secrets.sh');
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script.replace(/^\s*#.*$/gm, '')).not.toMatch(/\beval\b/);
    // Every bind-mounted secrets directory of the infrastructure has a service in the manifest.
    const mounts = [
      ...(read('infra/runtime/compose.infra.yaml') + read('infra/runtime/compose.telemetry.yaml')).matchAll(
        /\/run\/evia\/secrets\/([a-z]+):/g,
      ),
    ].map((match) => match[1]);
    for (const name of mounts) expect(Object.keys(secrets), String(name)).toContain(name);
  });

  it('EVM-007 AC3 (security-engineer B): the verifier container — image by ID, no socket, no ports, read-only, non-root, configuration and registry read-only', () => {
    const verifier = record(record(record(yaml('infra/deploy-agent/compose.agent.yaml'))['services'])['verifier']);
    expect(text(verifier['image'])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifier['pull_policy']).toBe('never');
    expect(verifier['read_only']).toBe(true);
    expect(verifier['cap_drop']).toEqual(['ALL']);
    expect(verifier['security_opt']).toEqual(['no-new-privileges:true']);
    expect(text(verifier['user'])).toBe('10010:10010');
    for (const key of ['ports', 'privileged', 'cap_add', 'devices', 'network_mode', 'environment', 'env_file'])
      expect(key in verifier, key).toBe(false);
    const volumes = list(verifier['volumes']).map(String);
    expect(volumes.some((volume) => volume.includes('docker.sock'))).toBe(false);
    for (const volume of volumes)
      expect(volume.endsWith(':ro') || ['/var/lib/evia/agent/out:/out', '/var/lib/evia/agent/state:/state'].includes(volume), volume).toBe(
        true,
      );
    expect(volumes).toContain('/var/lib/evia/registry:/var/lib/evia/deploy:ro');
    expect(volumes).toContain('/run/evia/agent/github-pat:/run/secrets/github-pat:ro');
  });

  it('EVM-007 AC3, AC4 (architect 12): one cycle per tick — oneshot unit under flock every 90 s, alert on failure; deploy.sh only after the verifier exits 0', () => {
    const service = read('infra/deploy-agent/systemd/evia-deploy-agent.service');
    expect(service).toContain('Type=oneshot');
    expect(service).toContain('ExecStart=/usr/bin/flock --nonblock /run/evia-deploy-agent.lock /usr/local/sbin/evia-deploy-cycle');
    expect(service).toContain('OnFailure=evia-deploy-agent-alert.service');
    expect(service).toContain('Requires=docker.service evia-metadata-block.service');
    expect(read('infra/deploy-agent/systemd/evia-deploy-agent.timer')).toContain('OnUnitInactiveSec=90s');
    const cycle = read('infra/deploy-agent/cycle.sh');
    expect(cycle).toContain('set -euo pipefail');
    expect(cycle.indexOf('run --rm verifier')).toBeLessThan(cycle.indexOf('exec /usr/local/sbin/evia-deploy'));
    const deploy = read('infra/deploy-agent/deploy.sh');
    expect(deploy).toMatch(/^set -euo pipefail$/m);
    expect(deploy.replace(/^\s*#.*$/gm, '')).not.toMatch(/\beval\b/);
    expect(deploy).toContain('--env-file /dev/null');
  });

  it('EVM-007 AC1 (A6; architect 3): infrastructure of the VM — only Caddy publishes ports (80, 443), clamd without egress, freshclam outside the API network, images from the fixed list', () => {
    const infra = record(yaml('infra/runtime/compose.infra.yaml'));
    const services = record(infra['services']);
    const published = Object.entries(services).filter(([, value]) => 'ports' in record(value));
    expect(published.map(([name]) => name)).toEqual(['caddy']);
    expect(list(record(services['caddy'])['ports'])).toEqual(['80:80', '443:443']);
    expect(read('infra/runtime/compose.infra.yaml')).not.toMatch(/2019:/);
    const networks = record(infra['networks']);
    expect(list(record(services['clamd'])['networks'])).toEqual(['evia-scan']);
    expect(record(networks['evia-scan'])['internal']).toBe(true);
    expect(list(record(services['freshclam'])['networks'])).toEqual(['evia-updates']);
    const allowed = Object.values(record(record(json('infra/runtime/infra-images.json'))['images'])).map(text);
    for (const [name, value] of Object.entries(services)) {
      expect(allowed, name).toContain(text(record(value)['image']));
      expect(record(value)['read_only'], name).toBe(true);
      expect(list(record(value)['cap_drop']), name).toEqual(['ALL']);
    }
    expect(record(record(services['postgres'])['environment'])['POSTGRES_PASSWORD_FILE']).toBe('/run/secrets/postgres-password');
  });

  it('EVM-007 AC4: the edge Caddy mounts the directory /etc/evia/caddy (not single files), because deploy.sh replaces upstream.caddy by rename and a file mount would keep the old inode', () => {
    const services = record(record(yaml('infra/runtime/compose.infra.yaml'))['services']);
    const volumes = list(record(services['caddy'])['volumes']).map(text);
    expect(volumes).toContain('/etc/evia/caddy:/etc/caddy:ro');
    expect(volumes.filter((volume) => /upstream\.caddy|Caddyfile/.test(volume))).toEqual([]);
    expect(volumes.filter((volume) => volume.includes('/etc/caddy'))).toEqual(['/etc/evia/caddy:/etc/caddy:ro']);
  });

  it('EVM-007 AC5, AC6 (security-engineer B "Caddy"): the edge Caddy — admin API on localhost, HSTS, no Server header, only the ACME issuer of Let us Encrypt, routing from the snippet', () => {
    const caddyfile = read('infra/runtime/Caddyfile');
    expect(caddyfile).toMatch(/^\tadmin localhost:2019$/m);
    expect(caddyfile).toContain('-Server');
    expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(caddyfile).toContain('dir https://acme-v02.api.letsencrypt.org/directory');
    expect(caddyfile).toContain('import /etc/caddy/upstream.caddy');
    expect(read('infra/deploy-agent/deploy.sh')).toContain('reverse_proxy evia-$1-api-1:3000');
  });

  it('EVM-007 AC7: the list of secrets used by the workflows is only RENOVATE_TOKEN (no deployment credential in GitHub)', () => {
    const references = filesBelow('.github/workflows', (path) => /\.ya?ml$/.test(path)).flatMap((path) =>
      [...read(path).matchAll(/secrets\.([A-Za-z_]+)/g)].map((match) => match[1]),
    );
    expect([...new Set(references)]).toEqual(['RENOVATE_TOKEN']);
  });

  it('EVM-007 AC1, AC7: the database roles — migrator owns the objects, the API login is a member of evia_app, no password in the repository', () => {
    const roles = read('infra/runtime/postgres-init/10-roles.sql');
    expect(roles).toContain('CREATE ROLE evia_migrator LOGIN NOSUPERUSER');
    expect(roles).toContain('IN ROLE evia_app');
    expect(roles).toContain('ALTER DATABASE evia OWNER TO evia_migrator;');
    expect(roles).not.toMatch(/PASSWORD\s+'/i);
  });
});
