/**
 * Backups, the restore test and their units on the repository (EVM-084 AC1-AC5; ADR-0009, ADR-0011, ADR-0018; SR-DATA-04,
 * SR-INFRA-05/07, SR-LOG-02; security-engineer P6, P8, P9; architect 7, 8, 10) plus synthetic violations proving the checkers detect them.
 * The code is inactive until the IaC session: these tests keep it from drifting and from activating half-way.
 */
import { describe, expect, it } from 'vitest';
import { exists, json, list, read, record, text } from '../src/files.ts';
import { backupConfigProblems, pgbackrestPinProblems } from '../src/iac.ts';

const conf = read('infra/runtime/pgbackrest/pgbackrest.conf');
const settings = read('infra/runtime/pgbackrest/postgresql-backup.conf');
const dockerfile = read('infra/images/postgres-pgbackrest/Dockerfile');
const images = record(record(json('infra/runtime/infra-images.json'))['images']);
const postgresImage = text(images['postgres']);
const unit = (name: string): string => read(`infra/deploy-agent/systemd/${name}`);

describe('pgBackRest configuration (EVM-084 AC1; security-engineer P8, architect 7)', () => {
  it('EVM-084 AC1: encrypted repository in pl-waw, no secret in the file, TLS on, 30 days of PITR, archive_timeout <= 300 s', () => {
    expect(backupConfigProblems(conf, settings)).toEqual([]);
  });

  it('EVM-084 AC1: the image is built from the digest of the postgres image, pgBackRest is pinned exactly and is at least 2.54', () => {
    expect(pgbackrestPinProblems(dockerfile, postgresImage)).toEqual([]);
    expect(dockerfile).toContain('pgbackrest=2.60.0-1.pgdg13+1');
    expect(exists('infra/images/postgres-pgbackrest/Dockerfile.dockerignore')).toBe(true);
  });

  it('EVM-084 AC1: the wrapper reads both secrets from files and the compose file carries no secret', () => {
    const wrapper = read('infra/images/postgres-pgbackrest/pgbackrest-wrapper.sh');
    expect(wrapper).toContain('$(cat /run/secrets/pgbackrest-cipher-pass)');
    expect(wrapper).toContain('$(cat /run/secrets/backup-s3-secret-access-key)');
    expect(wrapper).not.toMatch(/set -x/);
    expect(read('infra/runtime/compose.infra.yaml')).not.toMatch(/CIPHER_PASS|S3_KEY_SECRET/);
  });

  it('EVM-084 AC1: the image and archive_command are activated together — compose.infra.yaml uses the pgBackRest image only with a real digest', () => {
    const compose = read('infra/runtime/compose.infra.yaml');
    const active = /postgres-pgbackrest/.test(compose) || /archive_command/.test(compose);
    if (active) {
      expect(compose).toMatch(/postgres-pgbackrest[^\n]*@sha256:[0-9a-f]{64}/);
      expect(compose).toContain('archive_command');
    }
    for (const value of Object.values(images)) expect(text(value)).not.toMatch(/sha256:0{64}|sha256:([0-9a-f])\1{63}/);
  });

  it('EVM-084 AC1: violations — a plain repository, a short retention, a long archive_timeout, a secret in the file, TLS off, another region', () => {
    const swap = (from: string | RegExp, to: string): string => {
      const changed = conf.replace(from, to);
      expect(changed, String(from)).not.toBe(conf);
      return changed;
    };
    expect(backupConfigProblems(swap('repo1-cipher-type=aes-256-cbc', 'repo1-cipher-type=none'), settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('repo1-retention-full=35', 'repo1-retention-full=7'), settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('repo1-retention-full-type=time', 'repo1-retention-full-type=count'), settings)).not.toEqual([]);
    expect(backupConfigProblems(`${conf}\nrepo1-cipher-pass=abc\n`, settings)).not.toEqual([]);
    expect(backupConfigProblems(`${conf}\nrepo1-s3-key-secret=abc\n`, settings)).not.toEqual([]);
    expect(backupConfigProblems(`${conf}\nrepo1-storage-verify-tls=n\n`, settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('pl-waw', 'fr-par'), settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('repo1-path=/pgbackrest', 'repo1-path=/other'), settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('repo1-type=s3', 'repo1-type=posix'), settings)).not.toEqual([]);
    expect(backupConfigProblems(swap('evia-staging-db-backup', 'evia-staging-media'), settings)).not.toEqual([]);
    expect(backupConfigProblems(conf, settings.replace('archive_timeout = 300', 'archive_timeout = 900'))).not.toEqual([]);
    expect(backupConfigProblems(conf, settings.replace('archive_timeout = 300', 'archive_timeout = 0'))).not.toEqual([]);
    expect(backupConfigProblems(conf, settings.replace('archive_mode = on', 'archive_mode = off'))).not.toEqual([]);
    expect(
      backupConfigProblems(conf, settings.replace('pgbackrest-wrapper --stanza=evia', 'pgbackrest --repo1-cipher-pass=x --stanza=evia')),
    ).not.toEqual([]);
    expect(backupConfigProblems(conf, '')).not.toEqual([]);
  });

  it('EVM-084 AC1: violations in the image — another base, an old or unpinned pgBackRest, root, latest', () => {
    expect(pgbackrestPinProblems(dockerfile.replace(/@sha256:[0-9a-f]{64}/, ''), postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(dockerfile.replace(/sha256:1267c7e6/, 'sha256:aaaaaaaa'), postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(dockerfile.replace('pgbackrest=2.60.0-1.pgdg13+1', 'pgbackrest'), postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(dockerfile.replace('2.60.0-1.pgdg13+1', '2.53.1-1.pgdg13+1'), postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(dockerfile.replace('2.60.0-1', '1.99.0-1'), postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(`${dockerfile}\nUSER root\n`, postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems(`${dockerfile}\n# latest\n`, postgresImage)).not.toEqual([]);
    expect(pgbackrestPinProblems('', postgresImage)).not.toEqual([]);
  });
});

describe('systemd units of the backups and the restore test (EVM-084 AC1-AC5)', () => {
  const services = ['evia-backup-full', 'evia-backup-diff', 'evia-media-copy', 'evia-restore-sweep', 'evia-restore-test'];

  it('EVM-084 AC1, AC4: every unit is a oneshot with a local alert on failure, hardened, with a non-secret environment file and a time limit', () => {
    for (const name of services) {
      const service = unit(`${name}.service`);
      expect(service, name).toContain('Type=oneshot');
      expect(service, name).toContain('OnFailure=evia-restore-alert.service');
      expect(service, name).toContain('EnvironmentFile=/etc/evia/restore/restore.conf');
      expect(service, name).toMatch(/^TimeoutStartSec=\d+(min|h)$/m);
      for (const line of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectHome=true', 'ProtectSystem=full'])
        expect(service, name).toContain(line);
      expect(service.replace(/^#.*$/gm, ''), name).not.toMatch(/token|secret|pass|key=|Bearer/i);
      expect(unit(`${name}.timer`), name).toContain('Persistent=true');
    }
    expect(unit('evia-restore-alert.service')).toContain('/var/lib/evia/restore/alerts.log');
  });

  it('EVM-084 AC1-AC4: schedules — weekly full, daily differential, daily media copy, hourly sweeper, monthly restore test', () => {
    expect(unit('evia-backup-full.timer')).toMatch(/OnCalendar=Sun \*-\*-\* 01:30:00 Europe\/Warsaw/);
    expect(unit('evia-backup-diff.timer')).toMatch(/OnCalendar=Mon\.\.Sat \*-\*-\* 01:30:00 Europe\/Warsaw/);
    expect(unit('evia-media-copy.timer')).toMatch(/OnCalendar=\*-\*-\* 03:30:00 Europe\/Warsaw/);
    expect(unit('evia-restore-sweep.timer')).toContain('OnCalendar=hourly');
    expect(unit('evia-restore-test.timer')).toMatch(/OnCalendar=\*-\*-\d\d 04:00:00 Europe\/Warsaw/);
  });

  it('EVM-084 AC3, AC5: the monthly test runs the scenario; the time limits nest — the wait (4 h) < the dead-man shutdown (5 h) < the unit (6 h)', () => {
    const service = unit('evia-restore-test.service');
    expect(service).toContain('Environment=EVIA_RESTORE_SCENARIO=delete');
    expect(service).toContain('ExecStart=/usr/local/sbin/evia-restore-test');
    const run = read('infra/deploy-agent/restore/run.sh');
    const wait = Number(/MAX_WAIT_SECONDS="\$\{EVIA_RESTORE_MAX_WAIT_SECONDS:-(\d+)\}"/.exec(run)?.[1]);
    const deadman = Number(/DEADMAN_MINUTES="\$\{EVIA_RESTORE_DEADMAN_MINUTES:-(\d+)\}"/.exec(run)?.[1]);
    expect(wait).toBe(14400);
    expect(deadman * 60).toBeGreaterThan(wait);
    expect(Number(/^TimeoutStartSec=(\d+)h$/m.exec(service)?.[1]) * 3600).toBeGreaterThan(deadman * 60);
    expect(unit('evia-backup-full.service')).toContain('ExecStart=/usr/local/sbin/evia-backup full');
    expect(unit('evia-backup-diff.service')).toContain('ExecStart=/usr/local/sbin/evia-backup diff');
  });
});

describe('the scripts of the restore test and the backups (EVM-084 AC3, AC4; security-engineer P6, P9; SR-LOG-02)', () => {
  const scripts = [
    'lib.sh',
    'run.sh',
    'sweep.sh',
    'scenario.sh',
    'vm-restore.sh',
    's3-presign.sh',
    'backup.sh',
    'media-copy.sh',
    'bucket-verify.sh',
  ];
  const code = (name: string): string => read(`infra/deploy-agent/restore/${name}`).replace(/^\s*#.*$/gm, '');

  it('EVM-084 AC3 (P6): the API address is the exact constant; only loopback http in test mode; set -x, eval and a token in argv never appear', () => {
    const lib = code('lib.sh');
    expect(lib).toContain("readonly HCLOUD_API_DEFAULT='https://api.hetzner.cloud/v1'");
    expect(lib).toContain('EVIA_RESTORE_TEST_MODE:-}" = 1 ]');
    expect(lib).toMatch(/\^http:\/\/127\\\.0\\\.0\\\.1:\[0-9\]\{2,5\}\/v1\$/);
    for (const name of scripts) {
      expect(code(name), name).not.toMatch(/\beval\b|set -x|bash -x|--insecure|\bcurl\b[^\n]*\s-k\b|verify-tls=n/);
      expect(read(`infra/deploy-agent/restore/${name}`), name).toMatch(/^#!\/bin\/bash$/m);
      if (name !== 'lib.sh') expect(read(`infra/deploy-agent/restore/${name}`), name).toMatch(/^set -(euo|uo) pipefail$/m);
    }
  });

  it('EVM-084 AC3 (P9): the VM of the test is created with the firewall in the create request, in a fixed EU location list, from an image id, with no key to write', () => {
    const run = code('run.sh');
    expect(run).toContain('firewalls: [{firewall: $firewall}]');
    expect(run).toContain('location_allowed "$RESTORE_LOCATION"');
    expect(run).toContain('[[ "$RESTORE_IMAGE" =~ ^[0-9]+$ ]]');
    expect(run).toContain('ssh_pwauth: false');
    expect(run).toContain('disable_root: true');
    expect(run).toContain('passwd, -l, root');
    expect(run).toContain('ssh.service, ssh.socket');
    expect(run).toContain('shutdown, -h');
    expect(run).toContain('trap cleanup EXIT');
    expect(run).toMatch(/trap 'exit 130' INT/);
    expect(run).toMatch(/trap 'exit 143' TERM/);
    expect(run).toContain('flock -n 9');
    // the user-data gets the read key, the passwords and the signed PUT: never the Hetzner token, the backup-writer key or the orchestrator key
    const userData = run.slice(
      run.indexOf('secret_entry()'),
      run.indexOf('jq -n --arg name "evia-restore-$RUN_ID" --arg run "$RUN_ID" --arg type'),
    );
    expect(userData).not.toMatch(/restore-hcloud-token|backup-s3-secret|restore-orchestrator-s3|HCLOUD/);
    for (const name of [
      'restore-reader-s3-secret-access-key',
      'pgbackrest-cipher-pass',
      'rclone-crypt-password',
      'rclone-crypt-password2',
      'restore-storagebox-password',
    ])
      expect(userData).toContain(name);
    // an inbound rule is never created
    expect(run).not.toMatch(/direction: "in"/);
    // the root password of the answer is never read
    expect(run).not.toContain('root_password');
    expect(run).toContain("jq -r '.server.id | tostring'");
  });

  it('EVM-084 AC3 (P5): the result is untrusted — size limit, whitelist of fields, types, run id, atomic last.json; the signed URL lives at most 2 hours', () => {
    const run = code('run.sh');
    expect(run).toContain('RESULT_MAX_BYTES=16384');
    expect(run).toContain('--max-filesize "$RESULT_MAX_BYTES"');
    expect(run).toContain('(keys - [');
    expect(run).toContain('.runId == $run');
    expect(run).toContain('mv -f -- "$WORK/last.json" "$STATE_DIR/last.json"');
    expect(run).toContain('PRESIGN_TTL=7200');
    expect(code('s3-presign.sh')).toContain('S3_PRESIGN_MAX_EXPIRES:-7200');
    expect(code('vm-restore.sh')).toContain("-H 'If-None-Match: *'");
  });

  it('EVM-084 AC4 (P10): the sweeper covers every type of resource the orchestrator creates, images only snapshot or backup, firewalls only with the label', () => {
    const sweep = code('sweep.sh');
    for (const kind of ['servers', 'volumes', 'primary_ips', 'firewalls']) expect(sweep).toContain(`sweep ${kind} /${kind}`);
    expect(sweep).toContain('"type=snapshot"');
    expect(sweep).toContain('"type=backup"');
    expect(sweep).not.toMatch(/type=system|type=app/);
    expect(sweep).toContain('label_selector=$(label_selector)');
    expect(sweep).toContain('MAX_AGE="${EVIA_SWEEP_MAX_AGE_SECONDS:-86400}"');
    const run = code('run.sh');
    for (const created of ['/firewalls', '/servers']) expect(run).toContain(`hc_request POST ${created}`);
    expect(run).not.toMatch(/hc_request POST \/(volumes|images|primary_ips)/);
  });

  it('EVM-084 AC5: the scenario deletes only after a fresh backup and heals always (trap), with GetObjectVersion-based copy and no DeleteObjectVersion', () => {
    const scenario = code('scenario.sh');
    expect(scenario.indexOf('backup --type=incr')).toBeLessThan(scenario.indexOf('bk delete'));
    expect(scenario).toContain('--s3-version-at "$T"');
    expect(scenario).toContain('"$PGBACKREST_BIN" check');
    expect(scenario).toContain('"$PGBACKREST_BIN" info');
    expect(scenario).toContain('restore-repo-heal-failed');
    expect(scenario).not.toMatch(/--s3-versions\b.*delete|DeleteObjectVersion|purge/);
    expect(code('run.sh')).toContain('"$SELF_DIR/scenario.sh" heal "$SCENARIO_STATE"');
    expect(code('vm-restore.sh')).toContain('--repo-target-time=');
  });

  it('EVM-084 AC2: the media copy never deletes on the target and uses the read key, not the key of the application', () => {
    const copy = code('media-copy.sh');
    expect(copy).toContain('copy --checksum');
    expect(copy).not.toMatch(/\b(sync|move|purge|deletefile)\b/);
    expect(copy).toContain('media-backup-reader-s3-secret-access-key');
    expect(copy).not.toMatch(/media-s3-secret-access-key|backup-s3-secret/);
    expect(copy).toContain('RCLONE_CONFIG_MEDIA_FILENAME_ENCRYPTION=standard');
    expect(copy).toContain('RCLONE_CONFIG_BOX_KNOWN_HOSTS_FILE');
  });

  it('EVM-084: the manifest of the runtime files lists no secret of the restore units for a container', () => {
    const services = record(record(json('infra/deploy-agent/secrets.manifest.json'))['services']);
    const files = Object.values(services).flatMap((value) => list(record(value)['files']).map(String));
    for (const name of files) expect(name).not.toMatch(/^(restore|rclone|media-backup|media-copy)/);
  });
});
