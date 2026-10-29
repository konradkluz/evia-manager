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
  'buildx_version',
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
    // the SFTP port of the Storage Box (EVM-084): tcp/23 only to var.storagebox_cidrs, never a literal address list
    const storagebox = direction === 'out' && port === '23';
    if (direction === 'out' && !storagebox && (port !== 'rule.value.port' || protocol !== 'rule.value.protocol'))
      problems.push(`${file}: reguła wychodząca wyłącznie z listy local.outbound`);
    if (storagebox && (protocol !== 'tcp' || !/destination_ips\s*=\s*rule\.value\s*$/m.test(block)))
      problems.push(`${file}: port 23 wyłącznie tcp do var.storagebox_cidrs`);
    if (direction === 'in' && !['tcp'].includes(protocol)) problems.push(`${file}: protokół wejściowy ${protocol} spoza tcp`);
  }
  if (!content.includes('for_each = length(var.admin_ssh_cidrs) > 0 ? [var.admin_ssh_cidrs] : []'))
    problems.push(`${file}: reguła SSH tylko, gdy var.admin_ssh_cidrs nie jest pusta`);
  const adminVariable = hclBlock(content, /variable "admin_ssh_cidrs"\s*\{/) ?? '';
  if (!/default\s*=\s*\[\]/.test(adminVariable)) problems.push(`${file}: admin_ssh_cidrs domyślnie pusta`);
  if (!adminVariable.includes('contains(["0.0.0.0/0", "::/0"], cidr)'))
    problems.push(`${file}: walidacja zakazująca SSH z całego internetu`);
  if (!content.includes('for_each = length(var.storagebox_cidrs) > 0 ? [var.storagebox_cidrs] : []'))
    problems.push(`${file}: reguła SFTP tylko, gdy var.storagebox_cidrs nie jest pusta`);
  const storageboxVariable = hclBlock(content, /variable "storagebox_cidrs"\s*\{/) ?? '';
  if (!/default\s*=\s*\[\]/.test(storageboxVariable)) problems.push(`${file}: storagebox_cidrs domyślnie pusta`);
  if (!storageboxVariable.includes('contains(["0.0.0.0/0", "::/0"], cidr)'))
    problems.push(`${file}: walidacja zakazująca portu 23 dla całego internetu`);
  if (!storageboxVariable.includes('can(cidrhost(cidr, 0))')) problems.push(`${file}: walidacja CIDR dla storagebox_cidrs`);
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
  // Debian 13: systemd-cryptsetup is a separate package; without it /etc/crypttab is ignored and the data volume stays closed after a reboot.
  if (!/^ {2}- systemd-cryptsetup\s*$/m.test(template))
    problems.push('user-data: pakiet systemd-cryptsetup (bez niego crypttab jest ignorowany po reboocie)');
  // The deploy-agent image needs BuildKit (FROM --platform, Dockerfile.dockerignore): pinned buildx plugin, held like the other Docker packages.
  if (!template.includes('docker-buildx-plugin=${buildx_version}') || !/apt-mark hold [^\n]*docker-buildx-plugin/.test(template))
    problems.push('user-data: docker-buildx-plugin w przypiętej wersji (buildx_version) i apt-mark hold');
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

/**
 * Object Storage (EVM-084 AC2; ADR-0009, ADR-0011; SR-INFRA-02/03/07, SR-PRIV-04; security-engineer P1-P4, architect 1-5).
 * The policies as data: which application key may do what in which bucket. `bucketProblems` compares the HCL text of
 * modules/object-storage with them; the Deny statements (privileged actions, other applications, overwrite of the register)
 * are required by name.
 */
export const BUCKET_POLICIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = Object.freeze({
  media_allow: {
    media_app: [
      's3:PutObject',
      's3:GetObject',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListMultipartUploadParts',
      's3:ListBucket',
    ],
    // RR-42: the worker reads originals for the scan (GetObject, HeadObject) and removes the expired ones (DeleteObject); it never writes.
    media_worker: ['s3:GetObject', 's3:DeleteObject', 's3:ListBucket'],
    media_backup_reader: ['s3:ListBucket', 's3:GetObject'],
  },
  register_allow: {
    register_writer: ['s3:PutObject'],
    restore_reader: ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket', 's3:ListBucketVersions'],
  },
  db_backup_allow: {
    backup_writer: [
      's3:PutObject',
      's3:GetObject',
      's3:GetObjectVersion',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListMultipartUploadParts',
      's3:ListBucket',
      's3:ListBucketVersions',
    ],
    restore_reader: ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket', 's3:ListBucketVersions'],
  },
});
/** Never allowed to a key that runs on the VM; the policies Deny exactly these for every application. */
export const PRIVILEGED_ACTIONS = Object.freeze([
  's3:PutBucket*',
  's3:DeleteBucket*',
  's3:PutLifecycleConfiguration',
  's3:PutObjectLockConfiguration',
  's3:PutObjectRetention',
  's3:PutObjectLegalHold',
  's3:PutObjectAcl',
  's3:BypassGovernanceRetention',
  's3:DeleteObjectVersion',
]);
/** IAM permission sets no application may hold (project-wide reach). */
export const FORBIDDEN_PERMISSION_SETS = Object.freeze(['ObjectStorageFullAccess', 'ObjectStorageBucketsWrite', 'AllProducts']);

/** The text between the braces that open at the end of the match of `header` (comments removed by the caller). */
export function hclBlock(content: string, header: RegExp): string | null {
  const start = header.exec(content);
  if (start === null) return null;
  const open = start.index + start[0].length - 1;
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    if (content[index] === '}') depth -= 1;
    if (depth === 0) return content.slice(open + 1, index);
  }
  return null;
}

const quoted = (list: string): string[] => [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');

/** `name = { key = ["a", "b"] … }` of a locals block as a map of lists. */
export function hclListMap(content: string, name: string): Record<string, string[]> | null {
  const body = hclBlock(content, new RegExp(`^\\s*${name}\\s*=\\s*\\{`, 'm'));
  if (body === null) return null;
  const entries = [...body.matchAll(/^\s*(\w+)\s*=\s*\[([^\]]*)\]/gm)];
  return Object.fromEntries(entries.map((entry) => [entry[1] ?? '', quoted(entry[2] ?? '')]));
}

function hclList(content: string, name: string): string[] {
  const match = new RegExp(`^\\s*${name}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(content);
  return quoted(match?.[1] ?? '');
}

const isPrivileged = (action: string): boolean =>
  PRIVILEGED_ACTIONS.some((item) => (item.endsWith('*') ? action.startsWith(item.slice(0, -1)) : item === action));

/** The buckets, lifecycle, lock, encryption, CORS and policies in modules/object-storage/main.tf. */
export function bucketProblems(raw: string): string[] {
  const file = 'modules/object-storage';
  const content = raw.replace(/^\s*#.*$/gm, '');
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(`${file}: ${message}`);
  };
  const block = (header: string): string => hclBlock(content, new RegExp(`${header}\\s*\\{`)) ?? '';
  const bucket = (name: string): string => block(`resource "scaleway_object_bucket" "${name}"`);
  const lock = (name: string): string => block(`resource "scaleway_object_bucket_lock_configuration" "${name}"`);
  const policyOf = (name: string): string => block(`resource "scaleway_object_bucket_policy" "${name}"`);

  // region: pl-waw only (SR-PRIV-04)
  const region = block('variable "region"');
  need(
    /default\s*=\s*"pl-waw"/.test(region) && /contains\(\["pl-waw"\], var\.region\)/.test(region),
    'region wyłącznie pl-waw (dane osobowe)',
  );
  need(!/\bregion\s*=\s*"(?!pl-waw")/.test(content), 'region bucketu inny niż pl-waw');

  // the permission matrix as data
  for (const [name, expected] of Object.entries(BUCKET_POLICIES))
    need(JSON.stringify(hclListMap(content, name)) === JSON.stringify(expected), `${name} różni się od BUCKET_POLICIES`);
  const privileged = hclList(content, 'privileged_actions');
  for (const action of PRIVILEGED_ACTIONS) need(privileged.includes(action), `Deny dla aplikacji bez ${action}`);
  for (const [name, map] of Object.entries(BUCKET_POLICIES))
    for (const [app, actions] of Object.entries(map))
      for (const action of actions.filter(isPrivileged)) problems.push(`${file}: ${name}.${app} ma uprawnienie administracyjne ${action}`);

  // IAM: no key in the state, no broad permission set, the staging project only
  need(!/resource\s+"scaleway_iam_api_key"/.test(content), 'klucze API tworzone ręcznie w sesji IaC, nie w stanie (TM-64)');
  const apps = hclBlock(content, /^\s*apps\s*=\s*\{/m) ?? '';
  for (const set of FORBIDDEN_PERMISSION_SETS) need(!apps.includes(`"${set}"`), `zestaw uprawnień ${set} zabroniony`);
  need(
    /project_ids\s*=\s*\[var\.project_id\]/.test(block('resource "scaleway_iam_policy" "app"')),
    'polityka IAM ograniczona do projektu staging',
  );

  for (const name of ['media', 'register', 'db_backup']) {
    const body = bucket(name);
    need(body !== '', `bucket ${name}`);
    need(/versioning\s*\{\s*enabled\s*=\s*true/.test(body), `${name}: wersjonowanie`);
    need(/force_destroy\s*=\s*false/.test(body), `${name}: force_destroy = false`);
    const sse = block(`resource "scaleway_object_bucket_server_side_encryption_configuration" "${name}"`);
    need(/sse_algorithm\s*=\s*"AES256"/.test(sse), `${name}: szyfrowanie SSE-ONE (AES256)`);
    need(/acl\s*=\s*"private"/.test(block(`resource "scaleway_object_bucket_acl" "${name}"`)), `${name}: acl = "private"`);
    const policy = policyOf(name);
    need(policy !== '', `${name}: polityka bucketu`);
    need(
      /Sid\s*=\s*"AllowIac"[\s\S]*?Principal\s*=\s*\{\s*SCW\s*=\s*local\.iac_principal/.test(policy),
      `${name}: jawne zezwolenie dla aplikacji IaC`,
    );
    need(
      /Sid\s*=\s*"DenyPrivilegedForApplications"[\s\S]*?Action\s*=\s*local\.privileged_actions/.test(policy),
      `${name}: Deny uprawnień administracyjnych`,
    );
    need(/Sid\s*=\s*"DenyOtherApplications"/.test(policy), `${name}: Deny dla pozostałych aplikacji`);
    need(!/SCW\s*=\s*"\*"|Principal\s*=\s*"\*"|AWS\s*=\s*"\*"/.test(policy), `${name}: Principal "*"`);
  }

  // object lock at creation (it cannot be added later) and its default retention
  for (const name of ['media', 'db_backup'])
    need(/object_lock_enabled\s*=\s*true/.test(bucket(name)), `${name}: object lock przy tworzeniu`);
  need(/mode\s*=\s*"GOVERNANCE"\s*days\s*=\s*30\b/.test(lock('media')), 'media: lock GOVERNANCE 30 dni (ADR-0009)');
  need(/mode\s*=\s*"COMPLIANCE"\s*days\s*=\s*37\b/.test(lock('db_backup')), 'db_backup: lock COMPLIANCE 37 dni (ADR-0011)');

  const media = bucket('media');
  need(/abort_incomplete_multipart_upload_days\s*=\s*7\b/.test(media), 'media: niedokończone multipart 7 dni');
  need(/noncurrent_days\s*=\s*30\b/.test(media), 'media: stare wersje 30 dni');
  need(
    !/prefix\s*=\s*"quarantine\//.test(media.replace(/^\s*#.*$/gm, '')),
    'media: reguła prefiksu quarantine/ nie pasuje do kluczy media/… (RR-51)',
  );
  const cors = hclBlock(media, /cors_rule\s*\{/) ?? '';
  need(/allowed_origins\s*=\s*\[var\.panel_origin\]/.test(cors), 'CORS: jeden origin ze zmiennej');
  need(/allowed_methods\s*=\s*\["PUT"\]/.test(cors), 'CORS: wyłącznie PUT');
  need(/expose_headers\s*=\s*\["ETag"\]/.test(cors), 'CORS: ExposeHeaders ETag');
  need(/allowed_headers\s*=\s*\["[^*\]]*\]/.test(cors), 'CORS: jawna lista AllowedHeaders bez *');
  need(/max_age_seconds\s*=\s*(?:[1-9]\d{0,2}|[12]\d{3}|3[0-5]\d{2}|3600)\s*$/m.test(cors), 'CORS: MaxAge ≤ 3600');
  const panel = block('variable "panel_origin"');
  need(
    /startswith\(var\.panel_origin, "https:\/\/"\)/.test(panel) && /!strcontains\(var\.panel_origin, "\*"\)/.test(panel),
    'panel_origin: https bez *',
  );

  need(/noncurrent_days\s*=\s*37\b/.test(bucket('db_backup')), 'db_backup: NoncurrentVersionExpiration 37 dni (jak lock)');
  const register = bucket('register');
  need(
    /expiration\s*\{\s*days\s*=\s*40\b/.test(register) && /noncurrent_days\s*=\s*40\b/.test(register),
    'register: wygasanie 40 dni (SR-PRIV-04)',
  );

  // the register accepts only a conditional PutObject (no overwrite)
  need(
    /Sid\s*=\s*"DenyOverwriteByRegisterWriter"[\s\S]*?Action\s*=\s*\["s3:PutObject"\][\s\S]*?Null\s*=\s*\{\s*"s3:if-none-match"\s*=\s*"true"/.test(
      policyOf('register'),
    ),
    'register: PutObject tylko z If-None-Match',
  );

  // the restore-test result: its own application, its own prefix, no reach into the repository
  const dbPolicy = policyOf('db_backup');
  need(/restore_results_prefix\s*=\s*"restore-results\/"/.test(content), 'prefiks wyników testu odtworzenia');
  need(
    /Sid\s*=\s*"AllowRestoreResults"[\s\S]*?Resource\s*=\s*\["\$\{[^}]*\}\/\$\{local\.restore_results_prefix\}\*"\]/.test(dbPolicy),
    'orkiestrator: Put/Get tylko na prefiksie wyników',
  );
  need(
    /Sid\s*=\s*"DenyOrchestratorOutsideResults"[\s\S]*?\/pgbackrest\/\*/.test(dbPolicy),
    'orkiestrator: Deny na repozytorium pgbackrest/',
  );
  return problems;
}

/** `key=value` lines of a pgBackRest or PostgreSQL settings file (comments and sections skipped). */
function settings(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split('\n')) {
    const match = /^\s*([a-z0-9_-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match !== null && !line.trimStart().startsWith('#')) map.set(match[1] ?? '', (match[2] ?? '').replace(/^'(.*)'$/, '$1'));
  }
  return map;
}

/**
 * pgBackRest (EVM-084 AC1; ADR-0011; SR-DATA-04, SR-INFRA-07; security-engineer P8, architect 7): the repository in pl-waw encrypted with
 * aes-256-cbc, no secret in the file, TLS verification on, 30 days of point-in-time recovery, and the WAL archive switched at least
 * every 5 minutes (RPO <= 15 min also on an idle staging).
 */
export function backupConfigProblems(pgbackrest: string, postgres: string): string[] {
  const conf = settings(pgbackrest);
  const pg = settings(postgres);
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(`pgbackrest: ${message}`);
  };
  need(conf.get('repo1-type') === 's3', 'repozytorium typu s3 (poza VM)');
  need(conf.get('repo1-path') === '/pgbackrest', 'repo1-path=/pgbackrest');
  need(conf.get('repo1-s3-region') === 'pl-waw' && conf.get('repo1-s3-endpoint') === 's3.pl-waw.scw.cloud', 'endpoint i region pl-waw');
  need(conf.get('repo1-s3-bucket') === 'evia-staging-db-backup', 'bucket evia-staging-db-backup');
  need(conf.get('repo1-cipher-type') === 'aes-256-cbc', 'repo1-cipher-type=aes-256-cbc');
  for (const key of conf.keys())
    need(!/cipher-pass|key-secret|s3-key$|token/.test(key) || key === 'repo1-s3-key-type', `sekret w pliku konfiguracji (${key})`);
  need(!/verify|tls/i.test(pgbackrest.replace(/^\s*#.*$/gm, '')), 'weryfikacja TLS wyłącznie domyślna (brak verify-tls=n)');
  need(conf.get('repo1-retention-full-type') === 'time', 'retencja czasowa pełnych kopii');
  need(Number(conf.get('repo1-retention-full')) >= 30, 'retencja pełnych kopii pokrywa 30 dni PITR');
  const timeout = Number(pg.get('archive_timeout'));
  need(Number.isFinite(timeout) && timeout > 0 && timeout <= 300, 'archive_timeout <= 300 s (RPO <= 15 min na bezczynnym stagingu)');
  need(pg.get('archive_mode') === 'on' && pg.get('wal_level') === 'replica', 'archive_mode=on, wal_level=replica');
  need(
    /^pgbackrest-wrapper --stanza=evia archive-push %p$/.test(pg.get('archive_command') ?? ''),
    'archive_command przez pgbackrest-wrapper',
  );
  need(!/pass|secret|key/i.test(postgres.replace(/^\s*#.*$/gm, '')), 'bez sekretów w ustawieniach PostgreSQL');
  return problems;
}

/** The semantic version of an exact pgBackRest pin such as 2.60.0-1.pgdg13+1 against a minimum (--repo-target-time: 2.54). */
export function pgbackrestPinProblems(dockerfile: string, postgresDigest: string): string[] {
  const problems: string[] = [];
  const from = /^FROM (\S+)$/m.exec(dockerfile)?.[1] ?? '';
  if (!from.endsWith(`@${postgresDigest.split('@')[1] ?? 'missing'}`) || !/^postgres:\d+\.\d+-trixie@sha256:[0-9a-f]{64}$/.test(from))
    problems.push('postgres-pgbackrest: FROM z tym samym digestem co postgres w infra-images.json');
  const pin = /pgbackrest=(\d+)\.(\d+)(?:\.\d+)?-[\w.+~]+/.exec(dockerfile);
  if (pin === null) problems.push('postgres-pgbackrest: pgbackrest w dokładnie przypiętej wersji');
  else if (Number(pin[1]) < 2 || (Number(pin[1]) === 2 && Number(pin[2]) < 54))
    problems.push('postgres-pgbackrest: pgBackRest >= 2.54 (--repo-target-time)');
  if (/^USER\s+root\b/m.test(dockerfile)) problems.push('postgres-pgbackrest: bez USER root');
  if (/latest/.test(dockerfile)) problems.push('postgres-pgbackrest: bez tagu latest');
  return problems;
}

/**
 * The matrix key × bucket × area × operation (EVM-084 AC2, P5; security-engineer: the proof of the isolation of the keys). One source
 * of truth, BUCKET_POLICIES (plus the restore-test result prefix of the orchestrator): `bucketMatrixFile()` is rendered to
 * infra/deploy-agent/restore/bucket-matrix.tsv, which bucket-verify.sh executes with the REAL keys in the IaC session (and the test of
 * the script executes against a stand-in). `allow` = anything but 403, `deny` = exactly 403.
 */
export const APPLICATION_KEYS: Readonly<Record<string, { readonly idVariable: string; readonly secretFile: string }>> = Object.freeze({
  media_app: { idVariable: 'MEDIA_S3_ACCESS_KEY_ID', secretFile: 'media-s3-secret-access-key' },
  media_worker: { idVariable: 'MEDIA_WORKER_S3_ACCESS_KEY_ID', secretFile: 'media-worker-s3-secret-access-key' },
  media_backup_reader: { idVariable: 'MEDIA_BACKUP_READER_ACCESS_KEY_ID', secretFile: 'media-backup-reader-s3-secret-access-key' },
  register_writer: { idVariable: 'DELETION_REGISTER_S3_ACCESS_KEY_ID', secretFile: 'deletion-register-s3-secret-access-key' },
  backup_writer: { idVariable: 'BACKUP_WRITER_ACCESS_KEY_ID', secretFile: 'backup-s3-secret-access-key' },
  restore_reader: { idVariable: 'RESTORE_READER_ACCESS_KEY_ID', secretFile: 'restore-reader-s3-secret-access-key' },
  restore_orchestrator: { idVariable: 'RESTORE_ORCH_ACCESS_KEY_ID', secretFile: 'restore-orchestrator-s3-secret-access-key' },
});
/** The buckets (`<name>_allow` of BUCKET_POLICIES) and the variables with their names. */
export const MATRIX_BUCKETS: Readonly<Record<string, string>> = Object.freeze({
  media: 'MEDIA_BUCKET',
  register: 'DELETION_REGISTER_BUCKET',
  db_backup: 'DB_BACKUP_BUCKET',
});
/** The prefix of the probe object per area. */
export const MATRIX_AREAS: Readonly<Record<string, string>> = Object.freeze({
  any: 'verify-probes/',
  repo: 'pgbackrest/verify-probes/',
  results: 'restore-results/verify-probes/',
});
/** The S3 action behind each probed operation. */
export const MATRIX_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  list: 's3:ListBucket',
  get: 's3:GetObject',
  put: 's3:PutObject',
  delete: 's3:DeleteObject',
});
const ORCHESTRATOR_RESULTS_ACTIONS = Object.freeze(['s3:PutObject', 's3:GetObject']);

/** Does `key` get through on `operation` in `bucket` at `area` (the policies: Allow list, Deny outside it, Deny for the others)? */
export function matrixAllows(key: string, bucket: string, area: string, operation: string): boolean {
  const action = MATRIX_OPERATIONS[operation] ?? '';
  if (key === 'restore_orchestrator') return bucket === 'db_backup' && area === 'results' && ORCHESTRATOR_RESULTS_ACTIONS.includes(action);
  return (BUCKET_POLICIES[`${bucket}_allow`]?.[key] ?? []).includes(action);
}

/** The areas probed in a bucket: the database bucket has the repository and the results prefix, the others one. */
const areasOf = (bucket: string): string[] => (bucket === 'db_backup' ? ['repo', 'results'] : ['any']);

/** Every pair key × bucket × operation (and area for the object operations), in a stable order. */
export function bucketMatrixRows(): string[][] {
  const rows: string[][] = [];
  for (const key of Object.keys(APPLICATION_KEYS))
    for (const bucket of Object.keys(MATRIX_BUCKETS)) {
      const anyArea = areasOf(bucket)[0] ?? 'any';
      rows.push([key, bucket, '-', 'list', matrixAllows(key, bucket, anyArea, 'list') ? 'allow' : 'deny']);
      for (const area of areasOf(bucket))
        for (const operation of ['put', 'get', 'delete'])
          rows.push([key, bucket, area, operation, matrixAllows(key, bucket, area, operation) ? 'allow' : 'deny']);
    }
  return rows;
}

/** The text of infra/deploy-agent/restore/bucket-matrix.tsv: `key`, `bucket`, `area` declarations and `row` lines. */
export function bucketMatrixFile(): string {
  const lines = [
    '# Generated from BUCKET_POLICIES (tools/repo-policy/src/iac.ts, bucketMatrixFile): do not edit; the test of repo-policy compares it.',
    '# key <name> <variable with the access key id> <secret file>; bucket <name> <variable with the bucket>; area <name> <prefix>;',
    '# row <key> <bucket> <area> <operation> <allow|deny>',
    ...Object.entries(APPLICATION_KEYS).map(([name, key]) => `key\t${name}\t${key.idVariable}\t${key.secretFile}`),
    ...Object.entries(MATRIX_BUCKETS).map(([name, variable]) => `bucket\t${name}\t${variable}`),
    ...Object.entries(MATRIX_AREAS).map(([name, prefix]) => `area\t${name}\t${prefix}`),
    ...bucketMatrixRows().map((row) => `row\t${row.join('\t')}`),
  ];
  return `${lines.join('\n')}\n`;
}
