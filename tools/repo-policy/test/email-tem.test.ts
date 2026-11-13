/**
 * E-mail through Scaleway TEM and the address of the panel (EVM-089; SR-API-13, SR-COMM-02, SR-INFRA-05, SR-AUTH-09, SR-WEB-02; CWE-798, CWE-918, CWE-601).
 * The configuration of the repository is reviewed the way the deployment sees it: who may send mail and hold the key, where the panel lives, what the
 * old address of staging does and which DNS records the IaC gives to Konrad.
 */
import { describe, expect, it } from 'vitest';
import { json, list, read, record, text, yaml } from '../src/files.ts';

const channel = record(record(yaml('infra/runtime/compose.staging.yaml'))['services']);
const manifest = record(record(json('infra/deploy-agent/secrets.manifest.json'))['services']);
const environmentOf = (name: string): Record<string, unknown> => record(record(channel[name])['environment']);
const filesOf = (name: string): string[] => list(record(manifest[name])['files']).map(text);
const hostOf = (origin: string): string => new URL(origin).host;

describe('EVM-089 (B, C): who sends mail and who holds the key', () => {
  it('EVM-089 AC1 AC2: the worker uses the transport none or tem (never smtp on staging); the API has no EMAIL_* setting', () => {
    expect(['none', 'tem']).toContain(text(environmentOf('worker')['EMAIL_TRANSPORT']));
    expect(Object.keys(environmentOf('api')).filter((key) => key.startsWith('EMAIL_'))).toEqual([]);
    expect(Object.keys(environmentOf('web')).filter((key) => key.startsWith('EMAIL_'))).toEqual([]);
  });

  it('EVM-089 AC1 (SR-INFRA-05): the key of TEM is a file of the worker ONLY — no other service of the manifest holds it, and no environment carries its value', () => {
    for (const file of ['tem-api-key', 'tem-project-id', 'email-recipient-mode', 'email-allowed-recipients'])
      expect(
        Object.keys(manifest).filter((name) => filesOf(name).includes(file)),
        file,
      ).toEqual(['worker']);
    const worker = environmentOf('worker');
    expect(worker['EMAIL_TEM_API_KEY_FILE']).toBe('/run/secrets/tem-api-key');
    expect(
      Object.keys(worker).filter((key) => /KEY|TOKEN|SECRET|PASSWORD/.test(key) && !key.endsWith('_FILE') && !key.endsWith('_ID')),
    ).toEqual([]);
    expect(Object.keys(worker).some((key) => /^EMAIL_TEM_(API_KEY|URL|ENDPOINT|HOST)$/.test(key))).toBe(false);
    for (const value of Object.values(worker))
      expect(text(value)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('EVM-089 AC2 (C): the sender is on the domain of the panel, and the mode of the recipients is a file of the VM (the repository never says `otwarty`)', () => {
    const worker = environmentOf('worker');
    expect(worker['EMAIL_FROM']).toBe('powiadomienia@panel.eviacharge.pl');
    expect(worker['EMAIL_RECIPIENT_MODE_FILE']).toBe('/run/secrets/email-recipient-mode');
    expect(worker['EMAIL_ALLOWED_RECIPIENTS_FILE']).toBe('/run/secrets/email-allowed-recipients');
    expect(read('infra/runtime/compose.staging.yaml')).not.toMatch(/EMAIL_RECIPIENT_MODE:/);
  });

  it('EVM-089 AC4 (A, SSRF): the address of TEM is a constant of the code, never a setting, and the adapter is reachable only through the guarded factory', () => {
    const adapter = read('apps/api/src/platform/email/tem-email-sender.ts');
    expect(adapter).toContain("'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails'");
    expect(adapter).not.toMatch(/process\.env|\bEMAIL_TEM_(URL|ENDPOINT|HOST)\b/);
    expect(adapter).toContain("redirect: 'error'");
    expect(adapter).toMatch(/^class TemEmailSender /m);
    expect(adapter).not.toMatch(/export class TemEmailSender/);
    expect(adapter).not.toMatch(/dispatcher|rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(read('.env.example')).not.toMatch(/^EMAIL_TEM_(URL|ENDPOINT|HOST)=/m);
  });
});

describe('EVM-089 (E): the address of the panel is panel.eviacharge.pl everywhere, with no second origin', () => {
  it('EVM-089 AC4 (SR-AUTH-09): PANEL_ORIGIN is https://panel.eviacharge.pl and WEBAUTHN_RP_ID is its host, in the API and in the worker', () => {
    for (const name of ['api', 'worker']) {
      const environment = environmentOf(name);
      expect(text(environment['PANEL_ORIGIN']), name).toBe('https://panel.eviacharge.pl');
      expect(text(environment['WEBAUTHN_RP_ID']), name).toBe(hostOf(text(environment['PANEL_ORIGIN'])));
    }
  });

  it('EVM-089 AC4 (CWE-601): the Caddy block of the old host holds ONLY a redirect to the fixed host (no upstream, no {host}), the panel block keeps HSTS and the upstream', () => {
    const caddyfile = read('infra/runtime/Caddyfile');
    const block = (name: string): string => {
      const start = caddyfile.indexOf(`\n${name} {\n`);
      expect(start, name).toBeGreaterThan(-1);
      return caddyfile.slice(start, caddyfile.indexOf('\n}\n', start) + 3);
    };
    const old = block('staging.eviacharge.pl');
    expect(old).toContain('redir https://panel.eviacharge.pl{uri} 308');
    expect(old).not.toMatch(/upstream|reverse_proxy|\{host\}|\{hostport\}|\{http\.request\.host/);
    expect(old).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(old).toContain('import access_log');
    const panel = block('panel.eviacharge.pl');
    expect(panel).toContain('import /etc/caddy/upstream.caddy');
    expect(panel).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(panel).toContain('import access_log');
    expect(caddyfile.match(/redir /g)?.length).toBe(1);
  });

  it('EVM-089 AC4: the checks of the pipeline (deploy.sh, synthetic monitoring, ZAP) look at the new host and no other file of the repository points a probe at the old one', () => {
    expect(read('infra/deploy-agent/deploy.sh')).toContain('readonly DOMAIN="panel.eviacharge.pl"');
    expect(read('infra/observability/synthetic/checks.json')).not.toContain('staging.eviacharge.pl');
    expect(read('compose.yaml')).toContain("'https://panel.eviacharge.pl'");
    expect(read('compose.yaml')).not.toContain('https://staging.eviacharge.pl');
    expect(read('tools/staging-verify/lib/main.mjs')).toContain("export const HOST = 'panel.eviacharge.pl';");
  });
});

describe('EVM-089 AC3 (F): the sending domain in OpenTofu and the records for Konrad', () => {
  const main = read('infra/tofu/staging/main.tf');
  const module = read('infra/tofu/modules/tem/main.tf');

  it('EVM-089 AC3: the module of the new sending domain is panel.eviacharge.pl; the old domain STAYS until the sending is stable (no loss of sending during the switch)', () => {
    expect(main).toMatch(/module "tem_panel" \{[^}]*domain\s*=\s*"panel\.eviacharge\.pl"/);
    expect(main).toMatch(/module "tem" \{[^}]*domain\s*=\s*"staging\.eviacharge\.pl"/);
  });

  it('EVM-089 AC3: the values of SPF, DKIM and DMARC come from `tofu output` (from the resource, never typed), and the domain is a subdomain of eviacharge.pl', () => {
    expect(main).toMatch(/output "tem_panel_dns" \{[^}]*module\.tem_panel\.dns_records/);
    for (const attribute of ['spf_value', 'dkim_name', 'dkim_config', 'dmarc_name', 'status'])
      expect(module).toContain(`scaleway_tem_domain.this.${attribute}`);
    expect(module).toContain('endswith(var.domain, ".eviacharge.pl")');
    expect(module).toContain('contains(["fr-par", "nl-ams", "pl-waw"], var.region)');
  });

  it('EVM-089 AC4 (E): the CORS origin of the media bucket is ONE value from the variable (no wildcard, no second host)', () => {
    expect(read('infra/tofu/modules/object-storage/main.tf')).toMatch(/allowed_origins\s*=\s*\[var\.panel_origin\]/);
    expect(read('infra/tofu/staging/variables.tf')).toContain('https://panel.eviacharge.pl');
  });
});
