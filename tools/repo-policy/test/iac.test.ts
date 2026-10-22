/**
 * OpenTofu, the user-data of the VM and the IaC containers on the real repository, plus synthetic violations proving the
 * checkers detect them (EVM-007 AC1, AC7; ADR-0018 IaC; SR-INFRA-01/05/14; security-engineer A1, A7, B "IaC").
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { exists, filesBelow, gitIgnores, list, read, record, text, yaml } from '../src/files.ts';
import {
  ARM64_SERVER_TYPES,
  encryptionProblems,
  firewallProblems,
  iacComposeProblems,
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
