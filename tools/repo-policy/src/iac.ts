/**
 * OpenTofu rules (EVM-007 AC1, AC7; ADR-0018 IaC; SR-INFRA-01/05/14; security-engineer A1, A7 and B "IaC") — instead
 * of Rego, like the compose rules (bramka 5). The checks read the HCL text: the code is small and written to be checked
 * (one rule block per port, literal lists), and every rule has synthetic negative tests (checkers).
 */
import { list, record, text } from './files.ts';

/** Providers allowed in the roots, each pinned to an exact version and present in the lock file. */
export const ALLOWED_PROVIDERS = Object.freeze(['hetznercloud/hcloud', 'scaleway/scaleway']);
/** EU regions and locations (Hetzner, Scaleway) and the EU network zone of Hetzner. */
export const EU_LOCATIONS = Object.freeze(['nbg1', 'fsn1', 'hel1', 'fr-par', 'nl-ams', 'pl-waw']);
/** Outbound traffic of the VM (SR-INFRA-01): HTTPS, DNS, NTP — every other port is dropped by the Hetzner firewall. */
export const OUTBOUND = Object.freeze(['tcp/443', 'tcp/53', 'udp/53', 'udp/123']);
/** Template variables of user-data: none of them may carry a secret (AC1, AC7). */
export const USER_DATA_VARIABLES = Object.freeze([
  'admin_user',
  'admin_ssh_public_key',
  'data_volume_id',
  'docker_version',
  'compose_plugin_version',
  'containerd_version',
]);
/**
 * Hetzner Arm64 (Ampere, CAX) server types: the only ones the VM may use, because every release and infrastructure
 * image is linux/arm64 (ADR-0011/ADR-0018 annotation 2026-10-21; cax11 recommended for staging, cax21 if 4 GB is short).
 */
export const ARM64_SERVER_TYPES = Object.freeze(['cax11', 'cax21', 'cax31', 'cax41']);
/** Variables that must be given in the IaC session — no default that looks like a production value (architect 23). */
export const NO_DEFAULT_VARIABLES = Object.freeze(['server_type', 'location', 'admin_ssh_public_key']);

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/provisioner\s+"(local-exec|remote-exec|file)"/, 'provisioner local-exec/remote-exec/file (kod poza planem)'],
  [/data\s+"(external|http)"/, 'data source external/http (wykonanie lub pobranie poza planem)'],
  [/resource\s+"(random_password|random_string|tls_private_key)"/, 'sekret generowany do stanu (random_password, tls_private_key)'],
  [/\bsensitive\s*=\s*false\b/, 'sensitive = false'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'klucz prywatny w kodzie'],
  [/\b(access_key|secret_key|token|password)\s*=\s*"[^"$]+"/, 'poświadczenie zapisane w kodzie'],
];

const SECRET_NAME = /(token|secret|password|passphrase|private|credential|api_?key|access_?key)/i;

/** Forbidden constructs, credentials and outputs that expose a secret in any .tf file. */
export function tofuForbiddenProblems(file: string, content: string): string[] {
  const problems = FORBIDDEN.filter(([pattern]) => pattern.test(content)).map(([, reason]) => `${file}: ${reason}`);
  for (const match of content.matchAll(/output\s+"([^"]+)"\s*\{([^}]*)\}/g)) {
    const [, name = '', body = ''] = match;
    if (SECRET_NAME.test(name) || /var\.(state_passphrase|\w*token\w*|\w*secret\w*)/.test(body))
      problems.push(`${file}: output ${name} ujawnia sekret`);
  }
  return problems;
}

/** Roots: providers from the allow-list with an exact version, each locked with hashes for linux_amd64 and linux_arm64. */
export function providerProblems(file: string, content: string, lock: string | null): string[] {
  const problems: string[] = [];
  const block = /required_providers\s*\{([\s\S]*?)\n {2}\}/.exec(content)?.[1] ?? '';
  const entries = [...block.matchAll(/(\w+)\s*=\s*\{\s*source\s*=\s*"([^"]+)"(?:\s*version\s*=\s*"([^"]*)")?\s*\}/g)];
  if (entries.length === 0) problems.push(`${file}: brak required_providers`);
  if (lock === null) problems.push(`${file}: brak .terraform.lock.hcl obok konfiguracji`);
  for (const [, , source = '', version = ''] of entries) {
    if (!ALLOWED_PROVIDERS.includes(source)) problems.push(`${file}: dostawca ${source} spoza listy dozwolonych`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${file}: dostawca ${source} bez dokładnej wersji (x.y.z)`);
    if (lock === null) continue;
    const locked = new RegExp(`provider "registry\\.opentofu\\.org/${source}" \\{([\\s\\S]*?)\\n\\}`).exec(lock)?.[1] ?? '';
    if (!locked.includes(`version     = "${version}"`)) problems.push(`${file}: ${source} ${version} nie jest zablokowany w lock file`);
    if ((locked.match(/"h1:/g) ?? []).length < 2)
      problems.push(`${file}: ${source}: lock file bez skrótów h1 dla linux_amd64 i linux_arm64`);
  }
  return problems;
}

/** Regions and locations: literals and validation lists only from the EU; the Hetzner network zone eu-central. */
export function regionProblems(file: string, content: string): string[] {
  const problems: string[] = [];
  for (const match of content.matchAll(/\b(location|region)\s*=\s*"([^"]+)"/g))
    if (!EU_LOCATIONS.includes(match[2] ?? '')) problems.push(`${file}: ${match[1] ?? ''} ${match[2] ?? ''} poza UE`);
  for (const match of content.matchAll(/contains\(\[([^\]]*)\],\s*var\.(location|region)\)/g)) {
    const values = [...(match[1] ?? '').matchAll(/"([^"]+)"/g)].map((value) => value[1] ?? '');
    for (const value of values.filter((item) => !EU_LOCATIONS.includes(item)))
      problems.push(`${file}: walidacja ${match[2] ?? ''} dopuszcza ${value} poza UE`);
  }
  for (const match of content.matchAll(/network_zone\s*=\s*"([^"]+)"/g))
    if (match[1] !== 'eu-central') problems.push(`${file}: network_zone ${match[1] ?? ''} poza UE`);
  return problems;
}

/**
 * The firewall (SR-INFRA-01; security-engineer A1, P9): inbound 80/443 only, 22 only from var.admin_ssh_cidrs (empty
 * by default, never the whole internet), outbound exactly OUTBOUND — no rule without a port, no other protocol.
 */
export function firewallProblems(content: string): string[] {
  const problems: string[] = [];
  const file = 'modules/firewall';
  // static `rule { … }` blocks and the `content { … }` of `dynamic "rule"` blocks
  const blocks = [...content.matchAll(/\b(?:rule|content)\s*\{([^}]*)\}/g)].map((match) => match[1] ?? '');
  if (blocks.length === 0) problems.push(`${file}: brak reguł zapory`);
  for (const block of blocks) {
    const direction = /\bdirection\s*=\s*"(\w+)"/.exec(block)?.[1] ?? '';
    const port = /\bport\s*=\s*"?([\w.-]+)"?/.exec(block)?.[1] ?? '';
    const protocol = /\bprotocol\s*=\s*"?([\w.-]+)"?/.exec(block)?.[1] ?? '';
    if (direction === 'in' && port === '22' && !/source_ips\s*=\s*rule\.value/.test(block))
      problems.push(`${file}: port 22 wyłącznie z var.admin_ssh_cidrs`);
    if (direction === 'in' && !['80', '443', '22'].includes(port))
      problems.push(`${file}: port wejściowy ${port || '(każdy)'} spoza 80/443`);
    if (direction === 'out' && (port !== 'rule.value.port' || protocol !== 'rule.value.protocol'))
      problems.push(`${file}: reguła wychodząca wyłącznie z listy local.outbound`);
    if (direction === 'in' && !['tcp'].includes(protocol)) problems.push(`${file}: protokół wejściowy ${protocol} spoza tcp`);
  }
  if (!content.includes('for_each = length(var.admin_ssh_cidrs) > 0 ? [var.admin_ssh_cidrs] : []'))
    problems.push(`${file}: reguła SSH tylko, gdy var.admin_ssh_cidrs nie jest pusta`);
  if (!/variable "admin_ssh_cidrs"[\s\S]*?default\s*=\s*\[\]/.test(content)) problems.push(`${file}: admin_ssh_cidrs domyślnie pusta`);
  if (!content.includes('contains(["0.0.0.0/0", "::/0"], cidr)')) problems.push(`${file}: walidacja zakazująca SSH z całego internetu`);
  const outbound = /outbound\s*=\s*\[([\s\S]*?)\n {2}\]/.exec(content)?.[1] ?? '';
  const entries = [...outbound.matchAll(/protocol\s*=\s*"(\w+)",\s*port\s*=\s*"(\d+)"/g)].map(
    (match) => `${match[1] ?? ''}/${match[2] ?? ''}`,
  );
  if (JSON.stringify([...entries].sort()) !== JSON.stringify([...OUTBOUND].sort()))
    problems.push(`${file}: ruch wychodzący musi być dokładnie ${OUTBOUND.join(', ')} (znaleziono: ${entries.join(', ') || 'brak'})`);
  return problems;
}

/**
 * user-data (AC1, AC7; security-engineer A7): only the allowed template variables (none carries a secret), no secret
 * literal, the metadata block for Docker bridges in its own nftables table loaded before Docker, SSH by key only.
 */
export function userDataProblems(template: string): string[] {
  const problems: string[] = [];
  const variables = [...new Set([...template.matchAll(/(?<!\$)\$\{([^}]+)\}/g)].map((match) => (match[1] ?? '').trim()))];
  for (const name of variables.filter((item) => !USER_DATA_VARIABLES.includes(item)))
    problems.push(`user-data: zmienna szablonu ${name} spoza listy dozwolonych`);
  for (const name of variables.filter((item) => SECRET_NAME.test(item) && item !== 'admin_ssh_public_key'))
    problems.push(`user-data: zmienna ${name} wygląda na sekret`);
  if (/-----BEGIN|ghp_|github_pat_|glpat-|AKIA[0-9A-Z]{16}|SCW[0-9A-Z]{17}/.test(template))
    problems.push('user-data: literał wyglądający na sekret');
  if (/%\{/.test(template)) problems.push('user-data: bez dyrektyw szablonu %{ } (pętle i warunki ukrywają treść)');
  // Egress allows 443 only: the deb822 sources of Debian 13 (http:// by default) are moved to HTTPS by a bootcmd, before package_update.
  const bootcmd = /^bootcmd:[ \t]*\r?\n((?:[ \t]+.*\r?\n|[ \t]*\r?\n)*)/m.exec(template)?.[1] ?? '';
  if (!bootcmd.includes('/etc/apt/sources.list.d/*.sources') || !bootcmd.includes('s#http://#https://#g') || !/\bsed -i\b/.test(bootcmd))
    problems.push('user-data: bootcmd przepisujący źródła apt (/etc/apt/sources.list.d/*.sources) z http:// na https://');
  if (/^(?!\s*#).*(?:\buri:|\bURIs:|\bdeb(?:-src)?\s+(?:\[[^\]]*\]\s*)?)\s*http:\/\//im.test(template))
    problems.push('user-data: źródło apt przez http:// (zapora wypuszcza tylko 443)');
  // Arm64 VM: no architecture is assumed — the Docker repository takes it from dpkg.
  if (/\b(amd64|x86_64|x86-64|i386|i686)\b/.test(template)) problems.push('user-data: literał architektury x86 (VM Arm64)');
  if (!template.includes('deb [arch=$(dpkg --print-architecture) '))
    problems.push('user-data: architektura repozytorium Dockera z dpkg --print-architecture');
  for (const bridge of ['docker0', 'br-*'])
    if (!template.includes(`iifname "${bridge}" ip daddr 169.254.169.254 counter drop`))
      problems.push(`user-data: brak blokady metadanych z ${bridge}`);
  if (!template.includes('table inet evia') || !/type filter hook forward priority -10;/.test(template))
    problems.push('user-data: blokada metadanych we własnej tabeli inet evia (hook forward, priorytet przed filtrem Dockera)');
  if (!template.includes('Before=docker.service') || !template.includes('RequiredBy=docker.service'))
    problems.push('user-data: blokada metadanych ładowana przed docker.service');
  for (const line of ['PermitRootLogin no', 'PasswordAuthentication no', 'AllowUsers ${admin_user}'])
    if (!template.includes(line)) problems.push(`user-data: sshd bez „${line}”`);
  if (!/ssh_pwauth:\s*false/.test(template) || !/lock_passwd:\s*true/.test(template))
    problems.push('user-data: logowanie wyłącznie kluczem');
  return problems;
}

/** State and plan encryption enforced in every root (SR-INFRA-14; security-engineer B). */
export function encryptionProblems(file: string, content: string): string[] {
  const block = /encryption\s*\{([\s\S]*?)\n {2}\}/.exec(content)?.[1] ?? '';
  const problems: string[] = [];
  if (block === '') return [`${file}: brak bloku encryption (szyfrowanie stanu i planu)`];
  for (const part of ['state', 'plan'])
    if (!new RegExp(`\\b${part}\\s*\\{[^}]*enforced\\s*=\\s*true`).test(block))
      problems.push(`${file}: szyfrowanie ${part} z enforced = true`);
  if (!/passphrase\s*=\s*var\.state_passphrase/.test(block)) problems.push(`${file}: hasło szyfrowania wyłącznie ze zmiennej`);
  if (!/variable "state_passphrase"\s*\{[^}]*sensitive\s*=\s*true/.test(content)) problems.push(`${file}: state_passphrase sensitive`);
  return problems;
}

/** The server type is validated to Arm64 (CAX) types only — an x86 type cannot run the linux/arm64 images. */
export function serverTypeProblems(file: string, content: string): string[] {
  const match = /contains\(\[([^\]]*)\],\s*var\.server_type\)/.exec(content);
  if (match === null) return [`${file}: walidacja server_type (wyłącznie typy Arm64 CAX)`];
  const values = [...(match[1] ?? '').matchAll(/"([^"]+)"/g)].map((value) => value[1] ?? '');
  if (values.length === 0) return [`${file}: walidacja server_type bez typów`];
  return values
    .filter((value) => !ARM64_SERVER_TYPES.includes(value))
    .map((value) => `${file}: server_type ${value} spoza typów Arm64 (${ARM64_SERVER_TYPES.join(', ')})`);
}

/** Variables given in the IaC session: no default (architect 23). */
export function variableDefaultProblems(file: string, content: string): string[] {
  return NO_DEFAULT_VARIABLES.flatMap((name) => {
    const body = new RegExp(`variable "${name}"\\s*\\{([^}]*)\\}`).exec(content)?.[1];
    return body !== undefined && /\bdefault\s*=/.test(body) ? [`${file}: zmienna ${name} bez wartości domyślnej`] : [];
  });
}

/**
 * compose.iac.yaml (P11, architect 22; security-engineer B): exactly the `iac` service with the fixed entry point and
 * hardening, the repository read-only, the secret file and the session files outside the repository (../.evia-iac/),
 * no ports, socket, interpolation or extra environment.
 */
export function iacComposeProblems(document: unknown, raw: string): string[] {
  const problems: string[] = [];
  const top = record(document);
  const services = record(top['services']);
  if (JSON.stringify(Object.keys(services)) !== '["iac"]') problems.push('compose.iac.yaml: wyłącznie usługa iac');
  const iac = record(services['iac']);
  if (JSON.stringify(iac['entrypoint']) !== '["/usr/local/bin/evia-iac"]')
    problems.push('compose.iac.yaml: entrypoint /usr/local/bin/evia-iac');
  if (iac['read_only'] !== true || !list(iac['cap_drop']).includes('ALL') || !list(iac['security_opt']).includes('no-new-privileges:true'))
    problems.push('compose.iac.yaml: read_only, cap_drop ALL, no-new-privileges');
  if (['', '0', 'root', '0:0'].includes(text(iac['user']))) problems.push('compose.iac.yaml: użytkownik inny niż root');
  for (const key of ['ports', 'privileged', 'cap_add', 'devices', 'env_file', 'network_mode', 'command'])
    if (key in iac) problems.push(`compose.iac.yaml: zabronione ${key}`);
  if (JSON.stringify(Object.keys(record(iac['environment']))) !== '["HOME"]') problems.push('compose.iac.yaml: environment wyłącznie HOME');
  for (const volume of list(iac['volumes']).map(String)) {
    if (/docker\.sock/.test(volume)) problems.push('compose.iac.yaml: gniazdo Dockera');
    if (volume.startsWith('./') && !volume.endsWith(':ro')) problems.push(`compose.iac.yaml: repozytorium tylko do odczytu (${volume})`);
    if (!volume.startsWith('./infra/tofu:') && !volume.startsWith('../.evia-iac/'))
      problems.push(`compose.iac.yaml: montaż spoza listy (${volume})`);
  }
  if (text(record(record(top['secrets'])['iac'])['file']) !== '../.evia-iac/staging.env')
    problems.push('compose.iac.yaml: sekret iac wyłącznie z ../.evia-iac/staging.env (poza repozytorium)');
  if (raw.replace(/(^|\s)#.*$/gm, '').includes('${')) problems.push('compose.iac.yaml: interpolacja ${…} jest zabroniona');
  return problems;
}
