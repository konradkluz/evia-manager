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
  // EVM-084 (decision of Konrad 2026-11-12): the encrypted work volume - the id of the Hetzner Volume and the script (base64) that sets it up on the VM
  'work_volume_id',
  'work_volumes_script_b64',
  // EVM-084 (L8): uid:gid of the user of clamd in the pinned image (read in the IaC session; no default) - the owner of the scratch space, mode 0700
  'clamav_uid_gid',
]);
/**
 * Hetzner Arm64 (Ampere, CAX) server types: the only ones the VM may use, because every release and infrastructure
 * image is linux/arm64 (ADR-0011/ADR-0018 annotation 2026-10-21; cax11 recommended for staging, cax21 if 4 GB is short).
 */
export const ARM64_SERVER_TYPES = Object.freeze(['cax11', 'cax21', 'cax31', 'cax41']);
/** Variables that must be given in the IaC session — no default that looks like a production value (architect 23). */
export const NO_DEFAULT_VARIABLES = Object.freeze(['server_type', 'location', 'admin_ssh_public_key', 'clamav_uid_gid']);

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
  if (
    !/evia-metadata-block\.service(?:(?!- path:)[\s\S])*?Before=docker\.service(?:(?!- path:)[\s\S])*?RequiredBy=docker\.service/.test(
      template,
    )
  )
    problems.push('user-data: blokada metadanych ładowana przed docker.service');
  // EVM-084 (RR-75, RR-76): the work volumes of the films and of the scan are encrypted with an EPHEMERAL key and set up BEFORE Docker, which requires them.
  if (
    !/evia-work-volumes\.service(?:(?!- path:)[\s\S])*?Before=docker\.service(?:(?!- path:)[\s\S])*?RequiredBy=docker\.service/.test(
      template,
    )
  )
    problems.push('user-data: jednostka evia-work-volumes.service przed docker.service i wymagana przez niego');
  if (!template.includes('EVIA_WORK_DEVICE=/dev/disk/by-id/scsi-0HC_Volume_${work_volume_id}'))
    problems.push('user-data: urządzenie wolumenu roboczego z identyfikatora wolumenu (EVIA_WORK_DEVICE)');
  if (!/systemctl enable --now evia-work-volumes\.service/.test(template))
    problems.push('user-data: uruchomienie evia-work-volumes.service');
  if (!template.includes('encoding: b64') || !template.includes('${work_volumes_script_b64}'))
    problems.push('user-data: skrypt wolumenów roboczych przekazany jako base64 (jedno źródło: infra/deploy-agent/evia-work-volumes.sh)');
  if (!template.includes('EVIA_CLAMAV_OWNER=${clamav_uid_gid}'))
    problems.push('user-data: właściciel katalogu skanu (EVIA_CLAMAV_OWNER) z zmiennej clamav_uid_gid');
  if (/luks-(media|clamav|work)/.test(template))
    problems.push('user-data: klucz wolumenów roboczych jest efemeryczny — żadnego pliku klucza');
  for (const line of ['PermitRootLogin no', 'PasswordAuthentication no', 'AllowUsers ${admin_user}'])
    if (!template.includes(line)) problems.push(`user-data: sshd bez „${line}”`);
  if (!/ssh_pwauth:\s*false/.test(template) || !/lock_passwd:\s*true/.test(template))
    problems.push('user-data: logowanie wyłącznie kluczem');
  return problems;
}

/**
 * The script of the encrypted work volumes (EVM-084; RR-75, RR-76; decision of Konrad 2026-11-12): plain dm-crypt with a key read from /dev/urandom at every start and held
 * by the kernel only - no key file, no LUKS header, no crypttab or fstab entry; nodev,nosuid,noexec; immutable mount points; a volume with a signature is never formatted.
 */
export function workVolumesScriptProblems(script: string): string[] {
  const code = script.replace(/^\s*#.*$/gm, '');
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(`evia-work-volumes.sh: ${message}`);
  };
  need(
    /cryptsetup open --type plain --cipher aes-xts-plain64 --key-size 512 /.test(code),
    'cryptsetup open w trybie plain, aes-xts-plain64, klucz 512 bit',
  );
  const keyFiles = [...code.matchAll(/--key-file (\S+)/g)].map((match) => match[1]);
  need(keyFiles.length > 0 && keyFiles.every((file) => file === '/dev/urandom'), 'klucz wyłącznie z /dev/urandom (efemeryczny)');
  need(
    !/luksFormat|luksOpen|--type luks|crypttab|fstab|nofail|\/etc\/evia\/secrets/.test(code),
    'bez LUKS, crypttab, fstab, nofail i plików klucza',
  );
  need(!/urandom\s*>|\bof=|\$keyfile|keyfile=/.test(code), 'klucz nigdy nie trafia do pliku');
  need(/mount -o nodev,nosuid,noexec /.test(code), 'montaż z nodev,nosuid,noexec');
  need(
    code.includes('chattr +i') && code.indexOf('chattr +i') < code.indexOf('mount -o'),
    'punkt montowania niezapisywalny (chattr +i) przed montażem',
  );
  need(/mkfs\.ext4 -q -F -L /.test(code), 'system plików zakładany od nowa przy każdym starcie');
  need(/sfdisk -d/.test(code) && /blkid -p/.test(code), 'rozpoznanie tablicy partycji i sygnatury');
  need(
    /fail "[^"]*without a partition table: refusing"/.test(code),
    'wolumen z sygnaturą bez tablicy partycji jest odrzucany, nie formatowany',
  );
  need(/fail "work volume has \$partitions partitions instead of 2: refusing"/.test(code), 'inny układ partycji jest odrzucany');
  need(code.includes('=~ ^/dev/disk/by-id/scsi-0HC_Volume_[0-9]{1,12}$'), 'nazwa urządzenia sprawdzona wzorcem');
  // L6: named partitions, required before anything is opened or formatted
  need(code.includes('name=evia-media-video') && code.includes('name=evia-clamav-scan'), 'partycje GPT z nazwami przy tworzeniu');
  need(
    code.includes('name="evia-media-video"') && code.includes('name="evia-clamav-scan"'),
    'nazwy i rozmiar partycji wymagane przed otwarciem',
  );
  // L7: what is already mounted must be our mapping of type crypt
  need(/mounted_type" != crypt/.test(code) && /lsblk -no TYPE/.test(code), 'zamontowana ścieżka musi być naszym mapowaniem typu crypt');
  // L8: the scratch space of clamd belongs to the user of clamd (required parameter, no default), never world-writable
  need(
    code.includes('readonly CLAMAV_OWNER="${EVIA_CLAMAV_OWNER:?EVIA_CLAMAV_OWNER}"'),
    'EVIA_CLAMAV_OWNER wymagany, bez wartości domyślnej',
  );
  need(code.includes('"$CLAMAV_OWNER" 0700') && !/1777|0777/.test(code), 'katalog skanu: właściciel clamd, tryb 0700');
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
 * modules/object-storage with them. Scaleway bucket policies (2023-04-17) deny whatever is not explicitly allowed, accept no NotAction
 * and at most 10 statements, so a policy holds Allow statements only: the privileged actions, other applications and areas are
 * denied implicitly (bucket-verify.sh proves it against the real API).
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
  // EVM-052: the ZIP exports. The API key only reads (a signed link is signed with it: GetObject; ListBucket makes a vanished object a 404, not a 403);
  // the worker key builds the archive (a multipart upload: PutObject covers create, part and complete), checks it (HeadObject = GetObject) and removes it.
  // The code of EVM-052 uses the credentials of the process for both buckets, so no new application exists: the policies of the two buckets split the keys.
  exports_allow: {
    media_app: ['s3:GetObject', 's3:ListBucket'],
    media_worker: [
      's3:PutObject',
      's3:GetObject',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListMultipartUploadParts',
      's3:ListBucket',
    ],
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
/** Never allowed to a key that runs on the VM: no Allow list may hold one of them (denied implicitly; bucket-verify.sh checks it). */
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

/** The most statements Scaleway accepts in a bucket policy (`Bucket Policy can have up to 10 statements`). */
export const MAX_POLICY_STATEMENTS = 10;

/**
 * The shape the Scaleway API accepts (found in the IaC session of EVM-084): no NotAction/NotPrincipal, an Action in every statement,
 * at most 10 statements after the `for` expressions over `local.<bucket>_allow` are expanded, and no Deny (useless in 2023-04-17).
 */
export function policyShapeProblems(file: string, name: string, policy: string): string[] {
  const problems: string[] = [];
  const text = policy.replace(/^\s*#.*$/gm, '');
  if (/\bNot(?:Action|Principal|Resource)\s*=/.test(text))
    problems.push(`${file}: ${name}: NotAction/NotPrincipal/NotResource (Scaleway: Missing required field Action)`);
  if (/Effect\s*=\s*"Deny"/.test(text))
    problems.push(`${file}: ${name}: Deny (wersja 2023-04-17: odmowa domyślna, Deny jest bezużyteczny)`);
  const segments = text.split(/\bSid\s*=/).slice(1);
  if (segments.length === 0) problems.push(`${file}: ${name}: brak instrukcji`);
  for (const segment of segments) if (!/\bAction\s*=/.test(segment)) problems.push(`${file}: ${name}: instrukcja bez pola Action`);
  const loops = [...text.matchAll(/for app, actions in local\.(\w+)/g)];
  const expanded = loops.reduce((sum, loop) => sum + Object.keys(BUCKET_POLICIES[loop[1] ?? ''] ?? {}).length, 0);
  const filtered = (text.match(/\}\s*if app != "/g) ?? []).length;
  const count = segments.length - loops.length + expanded - filtered;
  if (count > MAX_POLICY_STATEMENTS) problems.push(`${file}: ${name}: ${count} instrukcji (limit Scaleway ${MAX_POLICY_STATEMENTS})`);
  return problems;
}

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
  for (const [name, map] of Object.entries(BUCKET_POLICIES))
    for (const [app, actions] of Object.entries(map))
      for (const action of actions.filter(isPrivileged)) problems.push(`${file}: ${name}.${app} ma uprawnienie administracyjne ${action}`);
  // the Deny of the privileged actions is gone (implicit deny): it is safe only while no list holds a wildcard that could cover one
  for (const [name, map] of Object.entries(BUCKET_POLICIES))
    for (const [app, actions] of Object.entries(map))
      for (const action of actions.filter((item) => item.includes('*')))
        problems.push(`${file}: ${name}.${app} ma znak wieloznaczny ${action} (odmowa domyślna uprawnień administracyjnych)`);

  // IAM: no key in the state, no broad permission set, the staging project only
  need(!/resource\s+"scaleway_iam_api_key"/.test(content), 'klucze API tworzone ręcznie w sesji IaC, nie w stanie (TM-64)');
  const apps = hclBlock(content, /^\s*apps\s*=\s*\{/m) ?? '';
  for (const set of FORBIDDEN_PERMISSION_SETS) need(!apps.includes(`"${set}"`), `zestaw uprawnień ${set} zabroniony`);
  need(
    /project_ids\s*=\s*\[var\.project_id\]/.test(block('resource "scaleway_iam_policy" "app"')),
    'polityka IAM ograniczona do projektu staging',
  );

  for (const name of ['media', 'register', 'db_backup', 'exports']) {
    const body = bucket(name);
    need(body !== '', `bucket ${name}`);
    // the exports are short-lived copies of originals (GPS): no versions, so that the one-day lifecycle really erases them (EVM-052)
    if (name !== 'exports') need(/versioning\s*\{\s*enabled\s*=\s*true/.test(body), `${name}: wersjonowanie`);
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
    problems.push(...policyShapeProblems(file, name, policy));
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

  // EVM-068 (TM-76; architect 6, security-engineer 5): the key of the worker writes the derivatives and NOTHING else - two names, add-only, never an original.
  // media_allow lists no s3:PutObject for it (checked above against BUCKET_POLICIES); the three statements below are the only PutObject it has.
  const mediaPolicy = policyOf('media');
  need(
    /Sid\s*=\s*"AllowWorkerDerivatives"[\s\S]*?Principal\s*=\s*\{\s*SCW\s*=\s*local\.app_principals\["media_worker"\]\s*\}[\s\S]*?Action\s*=\s*\["s3:PutObject"\][\s\S]*?Resource\s*=\s*\[for name in local\.derivative_object_names : "\$\{scaleway_object_bucket\.media\.name\}\/media\/\*\/\$\{name\}"\]/.test(
      mediaPolicy,
    ) && JSON.stringify(hclList(content, 'derivative_object_names')) === JSON.stringify(['thumbnail.webp', 'preview.webp', 'preview.mp4']),
    'media_worker: PutObject wyłącznie na media/*/thumbnail.webp, media/*/preview.webp i media/*/preview.mp4 (EVM-046)',
  );
  need(
    /Sid\s*=\s*"AllowWorkerDerivatives"[\s\S]*?Condition\s*=\s*\{\s*Null\s*=\s*\{\s*"s3:if-none-match"\s*=\s*"false"/.test(mediaPolicy),
    'media_worker: PutObject tylko z If-None-Match (Allow z warunkiem Null = "false", bez nadpisywania)',
  );
  need(
    !/\/originalb/.test(mediaPolicy) && !/DenyWorker/.test(mediaPolicy),
    'media_worker: oryginały media/*/original poza jakimkolwiek Allow (odmowa domyślna)',
  );
  need(
    /media_worker\s*=\s*\[[^\]]*"ObjectStorageObjectsWrite"/.test(apps),
    'media_worker: zestaw uprawnień Write (zawężony polityką bucketu)',
  );

  // EVM-052 (SR-DATA-07, SR-FILE-09): the bucket of the ZIP exports - no lock, no versions, no CORS (the browser follows a signed link), one day of life
  const exportsBucket = bucket('exports');
  need(
    !/object_lock_enabled\s*=\s*true/.test(exportsBucket),
    'exports: bez object lock (kopia oryginałów z GPS musi dać się usunąć po 24 h)',
  );
  need(!/versioning\s*\{\s*enabled\s*=\s*true/.test(exportsBucket), 'exports: bez wersjonowania');
  need(!/cors_rule\s*\{/.test(exportsBucket), 'exports: bez CORS (pobranie przez link, nie fetch)');
  need(
    /id\s*=\s*"exports-expire"[\s\S]*?expiration\s*\{\s*days\s*=\s*1\b/.test(exportsBucket) &&
      /abort_incomplete_multipart_upload_days\s*=\s*1\b/.test(exportsBucket),
    'exports: wygasanie po 1 dniu i przerwanie multipart po 1 dniu',
  );
  need(!/lock_configuration"\s+"exports"/.test(content), 'exports: brak konfiguracji object lock');
  // a multipart upload sends its parts without If-None-Match: a condition on s3:if-none-match would refuse the builder of the archive
  need(!/s3:if-none-match/.test(policyOf('exports')), 'exports: bez warunku s3:if-none-match (UploadPart go nie wysyła)');

  // the register accepts only a conditional PutObject (no overwrite): the writer has no unconditional Allow
  const registerPolicy = policyOf('register');
  need(
    /Sid\s*=\s*"AllowRegisterWriterConditionalPut"[\s\S]*?Action\s*=\s*local\.register_allow\["register_writer"\][\s\S]*?Condition\s*=\s*\{\s*Null\s*=\s*\{\s*"s3:if-none-match"\s*=\s*"false"/.test(
      registerPolicy,
    ) && /if app != "register_writer"/.test(registerPolicy),
    'register: PutObject tylko z If-None-Match (Allow z warunkiem; brak bezwarunkowego Allow dla zapisującego)',
  );

  // the restore-test result: its own application, its own prefix, no reach into the repository
  const dbPolicy = policyOf('db_backup');
  need(/restore_results_prefix\s*=\s*"restore-results\/"/.test(content), 'prefiks wyników testu odtworzenia');
  need(
    /Sid\s*=\s*"AllowRestoreResults"[\s\S]*?Resource\s*=\s*\["\$\{[^}]*\}\/\$\{local\.restore_results_prefix\}\*"\]/.test(dbPolicy),
    'orkiestrator: Put/Get tylko na prefiksie wyników',
  );
  need(!/pgbackrest/.test(dbPolicy), 'orkiestrator: żaden Allow nie obejmuje repozytorium pgbackrest/ (odmowa domyślna)');
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
  exports: 'MEDIA_EXPORT_BUCKET',
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

/** Does `key` get through on `operation` in `bucket` at `area` (the policies: an Allow list per key, everything else denied implicitly)? */
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
