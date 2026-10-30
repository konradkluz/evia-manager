/**
 * OpenTofu, the user-data of the VM and the IaC containers on the real repository, plus synthetic violations proving the
 * checkers detect them (EVM-007 AC1, AC7; ADR-0018 IaC; SR-INFRA-01/05/14; security-engineer A1, A7, B "IaC").
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { exists, filesBelow, gitIgnores, list, read, record, text, yaml } from '../src/files.ts';
import {
  APPLICATION_KEYS,
  ARM64_SERVER_TYPES,
  BUCKET_POLICIES,
  FORBIDDEN_PERMISSION_SETS,
  MATRIX_BUCKETS,
  MATRIX_OPERATIONS,
  PRIVILEGED_ACTIONS,
  bucketMatrixFile,
  bucketMatrixRows,
  bucketProblems,
  encryptionProblems,
  firewallProblems,
  hclBlock,
  hclListMap,
  iacComposeProblems,
  matrixAllows,
  providerProblems,
  regionProblems,
  serverTypeProblems,
  tofuForbiddenProblems,
  userDataProblems,
  variableDefaultProblems,
} from '../src/iac.ts';

const TOFU = 'infra/tofu';
const ROOTS = ['bootstrap', 'staging'];
const tfFiles = filesBelow(TOFU, (path) => path.endsWith('.tf'));
const rootText = (root: string): string =>
  tfFiles
    .filter((path) => path.startsWith(`${TOFU}/${root}/`))
    .map(read)
    .join('\n');
const firewall = read(`${TOFU}/modules/firewall/main.tf`);
const userData = read(`${TOFU}/modules/vm/templates/user-data.yaml.tftpl`);

describe('OpenTofu on the repository (EVM-007 AC1)', () => {
  it('EVM-007 AC1: modules for the network, firewall, VM and TEM and two roots (bootstrap, staging) with lock files', () => {
    for (const module of ['network', 'firewall', 'vm', 'tem']) expect(exists(`${TOFU}/modules/${module}/main.tf`), module).toBe(true);
    for (const root of ROOTS) expect(exists(`${TOFU}/${root}/.terraform.lock.hcl`), root).toBe(true);
  });

  it('EVM-007 AC1: no provisioners, external/http data sources, generated secrets or secret outputs in any .tf file', () => {
    expect(tfFiles.length).toBeGreaterThan(5);
    expect(tfFiles.flatMap((path) => tofuForbiddenProblems(path, read(path)))).toEqual([]);
  });

  it('EVM-007 AC1: providers from the allow-list with exact versions, locked with hashes for linux_amd64 and linux_arm64', () => {
    for (const root of ROOTS)
      expect(providerProblems(`${TOFU}/${root}`, rootText(root), read(`${TOFU}/${root}/.terraform.lock.hcl`))).toEqual([]);
  });

  it('EVM-007 AC1: every region, location and network zone is in the EU', () => {
    expect(tfFiles.flatMap((path) => regionProblems(path, read(path)))).toEqual([]);
  });

  it('EVM-007 AC1 (SR-INFRA-01, A1): firewall — in 80/443, 22 only from admin_ssh_cidrs (empty by default), out only 443/53/123', () => {
    expect(firewallProblems(firewall)).toEqual([]);
  });

  it('EVM-007 AC1, AC7: user-data has no secret, blocks the metadata service for containers and allows SSH by key only', () => {
    expect(userDataProblems(userData)).toEqual([]);
    // the data volume key is generated on the VM, never passed in
    expect(userData).toContain('head -c 64 /dev/urandom > "$keyfile"');
  });

  it('EVM-007 AC1 (SR-INFRA-14): state and plan encryption enforced in every root; no variable default looks like production', () => {
    for (const root of ROOTS) {
      expect(encryptionProblems(`${TOFU}/${root}`, rootText(root))).toEqual([]);
      expect(variableDefaultProblems(`${TOFU}/${root}`, rootText(root))).toEqual([]);
    }
    expect(variableDefaultProblems('modules/vm', read(`${TOFU}/modules/vm/main.tf`))).toEqual([]);
  });

  it('EVM-007 AC1 (Arm64 VM): the server type of the VM module and of staging is validated to Hetzner Arm64 (CAX) — the release images are linux/arm64 only', () => {
    expect(ARM64_SERVER_TYPES).toEqual(['cax11', 'cax21', 'cax31', 'cax41']);
    expect(serverTypeProblems('modules/vm', read(`${TOFU}/modules/vm/main.tf`))).toEqual([]);
    expect(serverTypeProblems(`${TOFU}/staging`, rootText('staging'))).toEqual([]);
    expect(rootText('staging')).toMatch(/variable "server_type"[^}]*cax11 recommended/);
  });

  it('EVM-007 AC1: state, plans, variable files, provider data and the IaC session directory are ignored by git; lock files are not', () => {
    for (const path of [
      'infra/tofu/staging/terraform.tfstate',
      'a.tfstate.backup',
      'staging.tfplan',
      'staging.tfvars',
      'infra/tofu/staging/.terraform/x',
      '.evia-iac/staging.env',
    ])
      expect(gitIgnores(path), path).toBe(true);
    expect(gitIgnores('infra/tofu/staging/.terraform.lock.hcl')).toBe(false);
  });

  it('EVM-007 AC1: CI never runs tofu plan or apply; iac-check runs only fmt, init without a backend and validate', () => {
    for (const path of filesBelow('.github', (file) => /\.ya?ml$/.test(file)))
      expect(read(path), path).not.toMatch(/tofu\s+(plan|apply)|compose\.iac\.yaml|run --rm iac\b(?!-)/);
    const check = read('infra/docker/iac/check.sh');
    expect(check).toContain('tofu fmt -check -recursive -diff "$src"');
    expect(check).toContain('init -backend=false -lockfile=readonly');
    expect(check).toContain('unset TF_LOG TF_LOG_PATH');
    expect(check).not.toMatch(/\b(plan|apply)\b(?! or)/);
  });
});

describe('IaC containers (EVM-007 AC1; P11, architect 22, security-engineer B)', () => {
  const compose = record(yaml('compose.yaml'));
  const iacCheck = record(record(compose['services'])['iac-check']);

  it('EVM-007 AC1: iac-check in compose.yaml has no secret, no session files and the read-only infra/tofu only', () => {
    expect(list(iacCheck['volumes'])).toEqual(['./infra/tofu:/src/infra/tofu:ro']);
    expect('secrets' in iacCheck).toBe(false);
    expect(read('compose.yaml')).not.toContain('.evia-iac');
    expect('secrets' in compose).toBe(false);
  });

  it('EVM-007 AC1: CI runs iac-check in the security job when the IaC code, its container, compose files or workflows changed', () => {
    const security = record(record(record(yaml('.github/workflows/ci.yml'))['jobs'])['security']);
    const step = list(security['steps'])
      .map(record)
      .find((entry) => text(entry['run']) === 'docker compose -f compose.yaml run --rm iac-check');
    expect(step?.['if']).toBe("needs.changes.outputs.iac == 'true'");
    expect(Object.keys(step ?? {}).sort()).toEqual(['if', 'name', 'run']);
  });

  it('EVM-007 AC1: compose.iac.yaml holds only the iac service with its fixed entry point and the secret file outside the repository', () => {
    expect(iacComposeProblems(parse(read('compose.iac.yaml')), read('compose.iac.yaml'))).toEqual([]);
  });

  it('EVM-007 AC1: the iac entry point allows only init|plan|apply|output of bootstrap|staging and exports allow-listed names only', () => {
    const iac = read('infra/docker/iac/iac.sh');
    expect(iac).toContain('case "$command" in init | plan | apply | output) ;; *)');
    expect(iac).toContain('case "$root" in bootstrap | staging) ;; *)');
    expect(iac).toContain('if [ "$#" -ne 2 ]');
    expect(iac).toContain('unset TF_LOG TF_LOG_PATH');
    expect(iac).not.toMatch(/\bset -x\b|\beval\b|echo "\$value"|printenv|\benv\b\s*$/m);
    const dockerfile = read('infra/docker/iac/Dockerfile');
    for (const line of dockerfile.split('\n').filter((entry) => /^(FROM|COPY --from=ghcr)/.test(entry)))
      expect(line, line).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });
});

describe('IaC checkers detect violations (EVM-007 AC1, AC7)', () => {
  it('EVM-007 AC1: forbidden constructs and secret outputs', () => {
    const bad = [
      'resource "x" "y" {\n provisioner "local-exec" {}\n}',
      'data "external" "x" {}',
      'data "http" "x" {}',
      'resource "random_password" "db" {}',
      'resource "tls_private_key" "k" {}',
      'token = "abc"',
      'output "db_password" {\n value = 1\n}',
      'output "x" {\n value = var.state_passphrase\n}',
    ];
    for (const content of bad) expect(tofuForbiddenProblems('x.tf', content), content).not.toEqual([]);
    expect(tofuForbiddenProblems('x.tf', 'output "ipv4" {\n value = module.vm.ipv4\n}')).toEqual([]);
  });

  it('EVM-007 AC1: a provider outside the list, a version range, a missing lock file or a lock without both platforms', () => {
    const root = (source: string, version: string): string =>
      `terraform {\n  required_providers {\n    x = {\n      source  = "${source}"\n      version = "${version}"\n    }\n  }\n}`;
    const lock = (source: string, version: string, hashes: number): string =>
      `provider "registry.opentofu.org/${source}" {\n  version     = "${version}"\n  hashes = [\n${'    "h1:x",\n'.repeat(hashes)}  ]\n}`;
    expect(providerProblems('r', root('hetznercloud/hcloud', '1.70.0'), lock('hetznercloud/hcloud', '1.70.0', 2))).toEqual([]);
    expect(providerProblems('r', root('hashicorp/random', '3.0.0'), lock('hashicorp/random', '3.0.0', 2))).not.toEqual([]);
    expect(providerProblems('r', root('hetznercloud/hcloud', '~> 1.70'), lock('hetznercloud/hcloud', '1.70.0', 2))).not.toEqual([]);
    expect(providerProblems('r', root('hetznercloud/hcloud', '1.70.0'), null)).not.toEqual([]);
    expect(providerProblems('r', root('hetznercloud/hcloud', '1.70.0'), lock('hetznercloud/hcloud', '1.70.0', 1))).not.toEqual([]);
    expect(providerProblems('r', root('hetznercloud/hcloud', '1.70.0'), lock('hetznercloud/hcloud', '1.69.0', 2))).not.toEqual([]);
    expect(providerProblems('r', 'terraform {}', '')).not.toEqual([]);
  });

  it('EVM-007 AC1: regions, locations, validation lists and network zones outside the EU', () => {
    expect(regionProblems('x', 'location = "ash"')).not.toEqual([]);
    expect(regionProblems('x', 'region = "us-east-1"')).not.toEqual([]);
    expect(regionProblems('x', 'condition = contains(["nbg1", "hil"], var.location)')).not.toEqual([]);
    expect(regionProblems('x', 'network_zone = "us-east"')).not.toEqual([]);
    expect(regionProblems('x', 'location = "fsn1"\nregion = "pl-waw"\nnetwork_zone = "eu-central"')).toEqual([]);
  });

  it('EVM-007 AC1 (A1): an open SSH port, another inbound port, a static outbound rule or any extra outbound port', () => {
    expect(
      firewallProblems(
        firewall.replace('port        = "22"\n      source_ips  = rule.value', 'port        = "22"\n      source_ips  = ["0.0.0.0/0"]'),
      ),
    ).not.toEqual([]);
    expect(firewallProblems(firewall.replace('port        = "443"', 'port        = "8080"'))).not.toEqual([]);
    expect(firewallProblems(`${firewall}\nrule {\n direction = "out"\n protocol = "tcp"\n port = "any"\n}`)).not.toEqual([]);
    expect(firewallProblems(`${firewall}\nrule {\n direction = "in"\n protocol = "udp"\n port = "443"\n}`)).not.toEqual([]);
    expect(firewallProblems(firewall.replace('{ protocol = "udp", port = "123"', '{ protocol = "tcp", port = "25"'))).not.toEqual([]);
    expect(firewallProblems(firewall.replace('default     = []', 'default     = ["10.0.0.0/8"]'))).not.toEqual([]);
    expect(firewallProblems(firewall.replace('contains(["0.0.0.0/0", "::/0"], cidr)', 'false'))).not.toEqual([]);
    expect(firewallProblems(firewall.replace('length(var.admin_ssh_cidrs) > 0 ? [var.admin_ssh_cidrs] : []', '[1]'))).not.toEqual([]);
    expect(firewallProblems('')).not.toEqual([]);
  });

  it('EVM-007 AC1 (egress 443 only): user-data moves the apt sources of Debian 13 to HTTPS in a bootcmd and leaves no http:// source', () => {
    expect(userData).toMatch(/^bootcmd:/m);
    expect(userData.indexOf('bootcmd:')).toBeLessThan(userData.indexOf('package_update: true'));
    expect(userDataProblems(userData.replaceAll('/etc/apt/sources.list.d/*.sources', '/etc/apt/sources.list.d/*.list'))).not.toEqual([]);
    expect(userDataProblems(userData.replaceAll('s#http://#https://#g', 's#x#y#g'))).not.toEqual([]);
    expect(userDataProblems(userData.replace(/^bootcmd:/m, 'unused:'))).not.toEqual([]);
    expect(userDataProblems(userData.replace('uri: https://deb.debian.org/debian\n', 'uri: http://deb.debian.org/debian\n'))).not.toEqual(
      [],
    );
    expect(
      userDataProblems(`${userData}\nwrite_files:\n  - content: |\n      URIs: http://mirror.hetzner.com/debian/packages`),
    ).not.toEqual([]);
    expect(userDataProblems(`${userData}\n# deb http://comment.example is only a comment`)).toEqual([]);
  });

  it('EVM-007 AC1, AC7: user-data installs systemd-cryptsetup (Debian 13 ignores crypttab without it) and a pinned docker-buildx-plugin', () => {
    expect(userDataProblems(userData.replace(/^ {2}- systemd-cryptsetup\r?\n/m, ''))).not.toEqual([]);
    expect(userDataProblems(userData.replace('docker-buildx-plugin=${buildx_version}', 'docker-buildx-plugin'))).not.toEqual([]);
    expect(
      userDataProblems(
        userData.replace(
          'apt-mark hold docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin',
          'apt-mark hold docker-ce',
        ),
      ),
    ).not.toEqual([]);
  });

  it('EVM-007 AC1, AC7 (A7): a secret variable or literal in user-data, a missing metadata block, password logins', () => {
    expect(userDataProblems(`${userData}\n\${hetzner_token}`)).not.toEqual([]);
    expect(userDataProblems(`${userData}\n\${db_password}`)).not.toEqual([]);
    expect(userDataProblems(`${userData}\n-----BEGIN OPENSSH PRIVATE KEY-----`)).not.toEqual([]);
    expect(userDataProblems(`${userData}\n%{ for x in y }`)).not.toEqual([]);
    expect(userDataProblems(userData.replace('iifname "br-*" ip daddr 169.254.169.254 counter drop', ''))).not.toEqual([]);
    expect(userDataProblems(userData.replace('priority -10;', 'priority 10;'))).not.toEqual([]);
    expect(userDataProblems(userData.replace('Before=docker.service', 'After=docker.service'))).not.toEqual([]);
    expect(userDataProblems(userData.replace('PermitRootLogin no', 'PermitRootLogin yes'))).not.toEqual([]);
    expect(userDataProblems(userData.replace('ssh_pwauth: false', 'ssh_pwauth: true'))).not.toEqual([]);
    // an escaped $${…} is shell, not a template variable
    expect(userDataProblems(`${userData}\necho "$\${HOME}"`)).toEqual([]);
  });

  it('EVM-007 AC1: unencrypted or not enforced state or plan, a literal passphrase, a default for a session variable', () => {
    const staging = rootText('staging');
    expect(encryptionProblems('s', staging.replace(/enforced = true/, 'enforced = false'))).not.toEqual([]);
    expect(encryptionProblems('s', staging.replace('passphrase = var.state_passphrase', 'passphrase = "x"'))).not.toEqual([]);
    expect(encryptionProblems('s', 'terraform {}')).not.toEqual([]);
    expect(encryptionProblems('s', staging.replace(/(variable "state_passphrase" \{[^}]*)sensitive\s*=\s*true/, '$1'))).not.toEqual([]);
    expect(variableDefaultProblems('s', 'variable "server_type" {\n type = string\n default = "cx53"\n}')).not.toEqual([]);
  });

  it('EVM-007 AC1 (Arm64 VM): a server type without validation, a validation admitting x86 types, an architecture literal in user-data', () => {
    const vm = read(`${TOFU}/modules/vm/main.tf`);
    expect(serverTypeProblems('s', vm.replace(/contains\(\[[^\]]*\], var\.server_type\)/, 'true'))).not.toEqual([]);
    expect(serverTypeProblems('s', vm.replace('"cax11", ', '"cax11", "cx33", '))).not.toEqual([]);
    expect(serverTypeProblems('s', vm.replace(/contains\(\[[^\]]*\], var\.server_type\)/, 'contains([], var.server_type)'))).not.toEqual(
      [],
    );
    expect(serverTypeProblems('s', 'terraform {}')).not.toEqual([]);
    expect(userDataProblems(userData.replace('arch=$(dpkg --print-architecture)', 'arch=amd64'))).not.toEqual([]);
    expect(userDataProblems(`${userData}\n# x86_64 only`)).not.toEqual([]);
  });

  it('EVM-007 AC1: compose.iac.yaml with another service, a writable repository, an in-repository secret, ports or interpolation', () => {
    const raw = read('compose.iac.yaml');
    const base = parse(raw) as Record<string, unknown>;
    const iac = record(record(base['services'])['iac']);
    const variant = (patch: Record<string, unknown>, top: Record<string, unknown> = {}): unknown => ({
      ...base,
      ...top,
      services: { iac: { ...iac, ...patch } },
    });
    expect(iacComposeProblems({ ...base, services: { iac, other: {} } }, raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ volumes: ['./infra/tofu:/src/infra/tofu'] }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ volumes: ['/var/run/docker.sock:/var/run/docker.sock'] }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ ports: ['8080:8080'] }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ entrypoint: ['sh'] }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ user: 'root', read_only: false }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({ environment: { HOME: '/tmp', TF_LOG: 'trace' } }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({}, { secrets: { iac: { file: './staging.env' } } }), raw)).not.toEqual([]);
    expect(iacComposeProblems(variant({}), `${raw}\nx: \${HCLOUD_TOKEN}`)).not.toEqual([]);
    expect(text(record(record(base['secrets'])['iac'])['file'])).toBe('../.evia-iac/staging.env');
  });
});

describe('Object Storage of staging (EVM-084 AC2; ADR-0009, ADR-0011; SR-INFRA-02/03/07, SR-PRIV-04)', () => {
  const storage = read(`${TOFU}/modules/object-storage/main.tf`);
  const staging = rootText('staging');
  const swap = (from: string | RegExp, to: string): string => {
    const changed = storage.replace(from, to);
    expect(changed, `mutation ${String(from)} changes the module`).not.toBe(storage);
    return changed;
  };

  it('EVM-084 AC2: the module is wired into staging with the pl-waw provider alias and the exact panel origin from a variable', () => {
    expect(bucketProblems(storage)).toEqual([]);
    expect(staging).toMatch(/provider "scaleway" \{\s*alias\s*=\s*"waw"\s*region\s*=\s*"pl-waw"/);
    expect(staging).toContain('providers          = { scaleway = scaleway.waw }');
    expect(staging).toMatch(/variable "panel_origin"\s*\{[^}]*type\s*=\s*string\s*\}/);
    expect(staging).not.toMatch(/variable "(panel_origin|iac_application_id)"[^}]*default/);
  });

  it('EVM-084 AC2: the matrix of permissions as data — the register key adds entries only, nobody has an administrative action', () => {
    expect(BUCKET_POLICIES['register_allow']?.['register_writer']).toEqual(['s3:PutObject']);
    for (const map of Object.values(BUCKET_POLICIES))
      for (const [app, actions] of Object.entries(map))
        for (const action of actions) {
          expect(action, `${app} ${action}`).not.toMatch(
            /Bucket(Policy|Versioning)|Lifecycle|ObjectLock|BypassGovernance|DeleteObjectVersion|^s3:\*$/,
          );
        }
    expect(BUCKET_POLICIES['db_backup_allow']?.['backup_writer']).toContain('s3:GetObjectVersion');
    expect(BUCKET_POLICIES['db_backup_allow']?.['backup_writer']).not.toContain('s3:DeleteObjectVersion');
    expect(Object.keys(BUCKET_POLICIES['media_allow'] ?? {})).not.toContain('backup_writer');
  });

  it('EVM-068 AC5 (TM-76): the key of the worker may put the two derivative names only, add-only, never an original — each of the three statements is required', () => {
    expect(storage).toContain('Sid       = "AllowWorkerDerivatives"');
    expect(storage).toContain('derivative_object_names = ["thumbnail.webp", "preview.webp"]');
    expect(
      bucketProblems(
        swap('derivative_object_names = ["thumbnail.webp", "preview.webp"]', 'derivative_object_names = ["thumbnail.webp", "*"]'),
      ),
    ).not.toEqual([]);
    expect(bucketProblems(swap('Sid       = "AllowWorkerDerivatives"', 'Sid       = "AllowWorker"'))).not.toEqual([]);
    expect(bucketProblems(swap('Sid       = "DenyWorkerOverwrite"', 'Sid       = "DenyWorker"'))).not.toEqual([]);
    expect(bucketProblems(swap(/(Sid\s*=\s*"DenyWorkerOverwrite"[\s\S]*?"s3:if-none-match"\s*=\s*)"true"/, '$1"false"'))).not.toEqual([]);
    expect(bucketProblems(swap('/media/*/original"]', '/media/*/original2"]'))).not.toEqual([]);
    expect(bucketProblems(swap('concat(actions, ["s3:PutObject"])', 'concat(actions, ["s3:PutObject", "s3:*"])'))).not.toEqual([]);
    expect(bucketProblems(swap(/(media_worker\s*=\s*\[[^\]]*?)"ObjectStorageObjectsWrite", /, '$1'))).not.toEqual([]);
    // the list of media_allow stays without PutObject for the worker (the matrix of the verification script proves the denial of a plain PUT)
    expect(BUCKET_POLICIES['media_allow']?.['media_worker']).not.toContain('s3:PutObject');
  });

  it('EVM-084 AC2 (P1): a bucket or provider outside pl-waw is refused', () => {
    expect(bucketProblems(swap('default     = "pl-waw"', 'default     = "fr-par"'))).not.toEqual([]);
    expect(bucketProblems(swap('contains(["pl-waw"], var.region)', 'contains(["pl-waw", "fr-par"], var.region)'))).not.toEqual([]);
    expect(bucketProblems(`${storage}\nresource "x" "y" {\n region = "fr-par"\n}`)).not.toEqual([]);
  });

  it('EVM-084 AC2 (P2): object lock at creation — media GOVERNANCE 30 d, db-backup COMPLIANCE 37 d, lifecycle zgodny z lockiem', () => {
    expect(
      bucketProblems(
        swap(/(resource "scaleway_object_bucket" "media" \{[^}]*?)object_lock_enabled = true/, '$1object_lock_enabled = false'),
      ),
    ).not.toEqual([]);
    expect(bucketProblems(swap('mode = "GOVERNANCE"\n      days = 30', 'mode = "GOVERNANCE"\n      days = 7'))).not.toEqual([]);
    expect(bucketProblems(swap('mode = "COMPLIANCE"\n      days = 37', 'mode = "COMPLIANCE"\n      days = 36'))).not.toEqual([]);
    expect(bucketProblems(swap('mode = "COMPLIANCE"', 'mode = "GOVERNANCE"'))).not.toEqual([]);
    expect(bucketProblems(swap('noncurrent_days = 37', 'noncurrent_days = 10'))).not.toEqual([]);
    expect(
      bucketProblems(swap('noncurrent_days = 30\n    }\n  }\n\n  # RR-51', 'noncurrent_days = 90\n    }\n  }\n\n  # RR-51')),
    ).not.toEqual([]);
  });

  it('EVM-084 AC2: versioning, SSE-ONE, private ACL and force_destroy = false in every bucket', () => {
    expect(
      bucketProblems(swap(/(resource "scaleway_object_bucket" "register" \{[\s\S]*?versioning \{\s*enabled\s*=\s*)true/, '$1false')),
    ).not.toEqual([]);
    expect(
      bucketProblems(swap(/(server_side_encryption_configuration" "media" \{[\s\S]*?sse_algorithm = )"AES256"/, '$1"none"')),
    ).not.toEqual([]);
    expect(
      bucketProblems(swap(/(resource "scaleway_object_bucket_acl" "db_backup" \{[\s\S]*?acl\s*=\s*)"private"/, '$1"public-read"')),
    ).not.toEqual([]);
    expect(
      bucketProblems(
        swap(
          'force_destroy       = false\n  object_lock_enabled = true\n\n  versioning {\n    enabled = true\n  }\n\n  cors_rule',
          'force_destroy       = true\n  object_lock_enabled = true\n\n  versioning {\n    enabled = true\n  }\n\n  cors_rule',
        ),
      ),
    ).not.toEqual([]);
  });

  it('EVM-084 AC2 (P3): the register expires after 40 days; the media bucket has no quarantine/ prefix rule (RR-51)', () => {
    expect(bucketProblems(swap(/(id\s*=\s*"register-retention"[\s\S]*?days\s*=\s*)40/, '$1400'))).not.toEqual([]);
    const withRule = swap(
      'noncurrent_days = 30',
      'noncurrent_days = 30\n    }\n  }\n  lifecycle_rule {\n    id = "q"\n    prefix = "quarantine/"\n    expiration {\n      days = 30',
    );
    expect(bucketProblems(withRule)).not.toEqual([]);
  });

  it('EVM-084 AC2 (P4): every policy names the IaC application, denies the privileged actions and the other applications, no Allow for "*"', () => {
    expect(
      bucketProblems(swap(/(resource "scaleway_object_bucket_policy" "media" \{[\s\S]*?Sid\s*=\s*)"AllowIac"/, '$1"AllowSomebody"')),
    ).not.toEqual([]);
    expect(
      bucketProblems(
        swap(/(resource "scaleway_object_bucket_policy" "register" \{[\s\S]*?Sid\s*=\s*)"DenyOtherApplications"/, '$1"Nothing"'),
      ),
    ).not.toEqual([]);
    expect(
      bucketProblems(
        swap(
          /(resource "scaleway_object_bucket_policy" "db_backup" \{[\s\S]*?Sid\s*=\s*"DenyPrivilegedForApplications"[\s\S]*?Action\s*=\s*)local\.privileged_actions/,
          '$1["s3:GetObject"]',
        ),
      ),
    ).not.toEqual([]);
    expect(bucketProblems(swap('Principal = { SCW = local.iac_principal }', 'Principal = { SCW = "*" }'))).not.toEqual([]);
    for (const action of PRIVILEGED_ACTIONS) expect(bucketProblems(swap(`    "${action}",\n`, '')), action).not.toEqual([]);
  });

  it('EVM-084 AC2 (P4): a key in the state, FullAccess / BucketsWrite / AllProducts or a project-wide scope is refused', () => {
    expect(bucketProblems(`${storage}\nresource "scaleway_iam_api_key" "k" {\n application_id = "x"\n}`)).not.toEqual([]);
    for (const set of FORBIDDEN_PERMISSION_SETS)
      expect(
        bucketProblems(swap('register_writer      = ["ObjectStorageObjectsWrite"]', `register_writer      = ["${set}"]`)),
        set,
      ).not.toEqual([]);
    expect(bucketProblems(swap('project_ids          = [var.project_id]', 'project_ids          = []'))).not.toEqual([]);
  });

  it('EVM-084 AC2: a wider list for an application key (register Get/Delete, backup DeleteObjectVersion, media bucket policy) differs from the data', () => {
    expect(bucketProblems(swap('register_writer = ["s3:PutObject"]', 'register_writer = ["s3:PutObject", "s3:GetObject"]'))).not.toEqual(
      [],
    );
    expect(
      bucketProblems(
        swap('"s3:ListBucketVersions"]\n  }\n  # The signing', '"s3:ListBucketVersions", "s3:DeleteObjectVersion"]\n  }\n  # The signing'),
      ),
    ).not.toEqual([]);
    expect(
      bucketProblems(
        swap(
          'media_backup_reader = ["s3:ListBucket", "s3:GetObject"]',
          'media_backup_reader = ["s3:ListBucket", "s3:GetObject", "s3:PutBucketPolicy"]',
        ),
      ),
    ).not.toEqual([]);
  });

  it('EVM-084 AC2: the register rejects a PutObject without If-None-Match (no overwrite)', () => {
    expect(bucketProblems(swap('Null = { "s3:if-none-match" = "true" }', 'Null = { "s3:if-none-match" = "false" }'))).not.toEqual([]);
    expect(bucketProblems(swap('Sid       = "DenyOverwriteByRegisterWriter"', 'Sid       = "Skipped"'))).not.toEqual([]);
  });

  it('EVM-084 AC2: CORS — one https origin from a validated variable, PUT, ExposeHeaders ETag, explicit headers, MaxAge ≤ 3600', () => {
    expect(bucketProblems(swap('allowed_origins = [var.panel_origin]', 'allowed_origins = ["*"]'))).not.toEqual([]);
    expect(bucketProblems(swap('allowed_methods = ["PUT"]', 'allowed_methods = ["PUT", "GET"]'))).not.toEqual([]);
    expect(bucketProblems(swap('expose_headers  = ["ETag"]', 'expose_headers  = []'))).not.toEqual([]);
    expect(
      bucketProblems(swap('allowed_headers = ["Content-Type", "Content-MD5", "x-amz-checksum-sha256"]', 'allowed_headers = ["*"]')),
    ).not.toEqual([]);
    expect(bucketProblems(swap('max_age_seconds = 3600', 'max_age_seconds = 86400'))).not.toEqual([]);
    expect(bucketProblems(swap('!strcontains(var.panel_origin, "*") && ', ''))).not.toEqual([]);
  });

  it('EVM-084 AC3 (P5): the result key is a separate application limited to restore-results/ and denied on pgbackrest/', () => {
    expect(
      bucketProblems(
        swap('"${scaleway_object_bucket.db_backup.name}/${local.restore_results_prefix}*"', '"${scaleway_object_bucket.db_backup.name}/*"'),
      ),
    ).not.toEqual([]);
    expect(bucketProblems(swap('/pgbackrest/*', '/other/*'))).not.toEqual([]);
    expect(bucketProblems(swap('restore_results_prefix  = "restore-results/"', 'restore_results_prefix  = "x/"'))).not.toEqual([]);
  });

  it('EVM-084 AC2: no secret leaves tofu — the outputs list names and ids only', () => {
    expect(tofuForbiddenProblems('main.tf', storage)).toEqual([]);
    expect(tofuForbiddenProblems('main.tf', `${storage}\noutput "media_secret_key" {\n value = "x"\n}`)).not.toEqual([]);
  });

  it('EVM-084: hclBlock and hclListMap — missing and unbalanced input', () => {
    expect(hclBlock('a = 1', /x\s*\{/)).toBeNull();
    expect(hclBlock('x {\n a = {', /x\s*\{/)).toBeNull();
    expect(hclListMap('a = 1', 'media_allow')).toBeNull();
    expect(hclListMap('media_allow = {\n  k = ["a", "b"]\n}', 'media_allow')).toEqual({ k: ['a', 'b'] });
    expect(bucketProblems('')).not.toEqual([]);
  });
});

describe('EVM-084 AC2: the matrix key × bucket (one source of truth for bucket-verify.sh)', () => {
  const file = read('infra/deploy-agent/restore/bucket-matrix.tsv');

  it('EVM-084 AC2: infra/deploy-agent/restore/bucket-matrix.tsv is exactly what BUCKET_POLICIES renders (regenerate it when the policies change)', () => {
    expect(file).toBe(bucketMatrixFile());
  });

  it('EVM-084 AC2: every key of every bucket is covered for list, get, put and delete; the cells follow BUCKET_POLICIES', () => {
    const rows = bucketMatrixRows();
    expect(Object.keys(APPLICATION_KEYS).sort()).toEqual([
      'backup_writer',
      'media_app',
      'media_backup_reader',
      'media_worker',
      'register_writer',
      'restore_orchestrator',
      'restore_reader',
    ]);
    expect(rows).toHaveLength(7 * (3 * 4 + 3));
    for (const key of Object.keys(APPLICATION_KEYS))
      for (const bucket of Object.keys(MATRIX_BUCKETS))
        for (const operation of Object.keys(MATRIX_OPERATIONS))
          expect(
            rows.some((row) => row[0] === key && row[1] === bucket && row[3] === operation),
            `${key} ${bucket} ${operation}`,
          ).toBe(true);
    // every pair of BUCKET_POLICIES is allowed for exactly its actions ...
    for (const [policy, map] of Object.entries(BUCKET_POLICIES))
      for (const [key, actions] of Object.entries(map))
        for (const [operation, action] of Object.entries(MATRIX_OPERATIONS))
          expect(matrixAllows(key, policy.replace('_allow', ''), 'any', operation), `${policy} ${key} ${operation}`).toBe(
            actions.includes(action),
          );
    // ... and every pair outside of it is denied
    for (const key of Object.keys(APPLICATION_KEYS).filter((name) => name !== 'restore_orchestrator'))
      for (const [policy, map] of Object.entries(BUCKET_POLICIES))
        if (!(key in map))
          for (const operation of Object.keys(MATRIX_OPERATIONS))
            expect(matrixAllows(key, policy.replace('_allow', ''), 'any', operation), `${policy} ${key} ${operation}`).toBe(false);
    // the orchestrator: put and get under restore-results/, nothing else anywhere
    expect(matrixAllows('restore_orchestrator', 'db_backup', 'results', 'put')).toBe(true);
    expect(matrixAllows('restore_orchestrator', 'db_backup', 'results', 'get')).toBe(true);
    for (const [bucket, area, operation] of [
      ['db_backup', 'results', 'delete'],
      ['db_backup', 'results', 'list'],
      ['db_backup', 'repo', 'get'],
      ['db_backup', 'repo', 'put'],
      ['media', 'any', 'get'],
      ['register', 'any', 'put'],
    ] as const)
      expect(matrixAllows('restore_orchestrator', bucket, area, operation), `${bucket} ${area} ${operation}`).toBe(false);
  });

  it('EVM-084 AC2: no key may delete in the register or write in the repository without being listed; a changed policy changes the matrix', () => {
    expect(matrixAllows('register_writer', 'register', 'any', 'delete')).toBe(false);
    expect(matrixAllows('register_writer', 'register', 'any', 'get')).toBe(false);
    expect(matrixAllows('restore_reader', 'db_backup', 'repo', 'put')).toBe(false);
    expect(matrixAllows('media_backup_reader', 'media', 'any', 'put')).toBe(false);
    expect(matrixAllows('media_app', 'db_backup', 'repo', 'get')).toBe(false);
    expect(matrixAllows('backup_writer', 'media', 'any', 'get')).toBe(false);
    expect(matrixAllows('unknown_key', 'media', 'any', 'get')).toBe(false);
    expect(matrixAllows('media_app', 'media', 'any', 'unknown_operation')).toBe(false);
  });
});

describe('EVM-084 AC2: the SFTP port of the Storage Box in the firewall of the VM', () => {
  const mutate = (from: string | RegExp, to: string): string => {
    const changed = firewall.replace(from, to);
    expect(changed, `mutation ${String(from)}`).not.toBe(firewall);
    return changed;
  };

  it('EVM-084 AC2: port 23 leaves the VM only to var.storagebox_cidrs, which is empty by default and never the whole internet', () => {
    expect(firewallProblems(firewall)).toEqual([]);
    expect(firewall).toContain('port            = "23"');
  });

  it('EVM-084 AC2: a literal or open destination, another protocol, a rule without the variable or a variable with a default is a problem', () => {
    expect(firewallProblems(mutate('destination_ips = rule.value', 'destination_ips = ["0.0.0.0/0", "::/0"]'))).not.toEqual([]);
    expect(firewallProblems(mutate('destination_ips = rule.value', 'destination_ips = local.anywhere'))).not.toEqual([]);
    expect(firewallProblems(mutate(/protocol\s*=\s*"tcp"\n(\s*)port\s*=\s*"23"/, 'protocol = "udp"\n$1port = "23"'))).not.toEqual([]);
    expect(
      firewallProblems(mutate('length(var.storagebox_cidrs) > 0 ? [var.storagebox_cidrs] : []', '[var.storagebox_cidrs]')),
    ).not.toEqual([]);
    expect(firewallProblems(mutate(/(variable "storagebox_cidrs"[\s\S]*?default\s*=\s*)\[\]/, '$1["10.0.0.0/8"]'))).not.toEqual([]);
    expect(
      firewallProblems(mutate(/(variable "storagebox_cidrs"[\s\S]*?)contains\(\["0.0.0.0\/0", "::\/0"\], cidr\)/, '$1false')),
    ).not.toEqual([]);
    expect(firewallProblems(mutate(/(variable "storagebox_cidrs"[\s\S]*?)can\(cidrhost\(cidr, 0\)\)/, '$1true'))).not.toEqual([]);
  });

  it('EVM-084 AC2: the staging root passes the variable through and it has an empty default', () => {
    const root = tfFiles
      .filter((path) => path.startsWith(`${TOFU}/staging/`))
      .map(read)
      .join('\n');
    expect(root).toContain('storagebox_cidrs = var.storagebox_cidrs');
    expect(root).toMatch(/variable "storagebox_cidrs" \{[^}]*default\s*=\s*\[\]/);
  });
});
