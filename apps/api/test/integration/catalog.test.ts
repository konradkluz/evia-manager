import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zWorkOrderTemplateList } from '@evia/contracts/zod';
import { createMobileSession, createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { setDeviceState } from '../support/mobile-flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});

const server = () => current.app.getHttpServer();
const BASE = '/api/v1/catalog';
const ROLES: readonly Role[] = ['administrator', 'editor', 'read_only'];
const OPERATIONS = [
  `${BASE}/work-order-templates`,
  `${BASE}/service-items`,
  `${BASE}/procedure-templates`,
  `${BASE}/document-kinds`,
] as const;

/** A signed-in browser session of the role, created like the matrix does (the clock moves a minute per request: per-IP limits). */
async function get(
  path: string,
  role: Role = 'administrator',
  options: { channel?: 'web' | 'mobile'; state?: 'active' | 'mfa_enrollment' } = {},
) {
  const user = await createUser(current.database.admin, current.clock, { role });
  const session = await createSession(current.database.admin, current.clock, user, options);
  current.clock.advance(61_000);
  return request(server()).get(path).set('Cookie', session.cookie);
}

interface Template {
  id: string;
  code: string;
  name: string;
  siteTypeHint: string | null;
  isActive: boolean;
  items: Array<{
    code: string;
    position: number;
    defaultQuantity: number;
    parameterSetCode: string | null;
    defaultParameters: Record<string, unknown>;
  }>;
  procedures: Array<{ code: string; name: string; stageCount: number }>;
  paymentMilestones: Array<{ code: string; position: number; sharePercent: number; invoiceHint: string; paymentTermDays: number }>;
}
interface TemplateList {
  items: Template[];
  nextCursor: null;
}

const activeTemplates = async (query = ''): Promise<TemplateList> =>
  (await get(`${BASE}/work-order-templates${query}`)).body as TemplateList;
const byCode = (list: TemplateList, code: string): Template => {
  const template = list.items.find((item) => item.code === code);
  if (template === undefined) throw new Error(`no template ${code} in the answer`);
  return template;
};

describe('reading templates for a new work order (EVM-019 AC4)', () => {
  it('EVM-019 AC4 the active templates come with a preview: items, processes with their stage count and payment milestones with shares', async () => {
    const response = await get(`${BASE}/work-order-templates`);
    expect(response.status).toBe(200);
    const list = response.body as TemplateList;
    expect(list.nextCursor).toBeNull();
    expect(list.items.map((template) => template.code)).toEqual([
      'house_full_package',
      'house_installation_only',
      'garage_full_process',
      'garage_installation_only',
      'garage_charger_installation',
    ]);
    expect(list.items.every((template) => template.isActive)).toBe(true);

    const garage = byCode(list, 'garage_full_process');
    expect(garage).toMatchObject({ name: 'Garaż — pełny proces', siteTypeHint: 'multi_family_garage' });
    expect(garage.items.map((item) => item.code)).toEqual([
      'building_management_approval',
      'technical_assessment',
      'fire_safety_opinion',
      'installation_design',
      'dso_agreement',
      'supply_installation',
      'charger_supply',
      'charger_installation',
      'measurements_acceptance',
    ]);
    expect(garage.items.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(garage.items[5]).toMatchObject({
      defaultQuantity: 1,
      parameterSetCode: 'supply_circuit',
      defaultParameters: { dedicatedCircuit: true, internalSupplyLine: true },
    });
    expect(garage.items[0]).toMatchObject({ parameterSetCode: null, defaultParameters: {} });
    expect(garage.procedures.map((procedure) => [procedure.code, procedure.stageCount])).toEqual([
      ['building_management_approval', 4],
      ['technical_assessment', 3],
      ['fire_safety_opinion', 2],
      ['installation_design', 2],
      ['dso_connection', 7],
      ['electrical_installation', 3],
      ['charger_procurement', 3],
      ['charger_installation', 4],
      ['measurements_acceptance', 2],
    ]);
    expect(garage.procedures[4]?.name).toBe('Uzgodnienia z OSD');
    expect(garage.paymentMilestones.map((milestone) => [milestone.code, milestone.sharePercent, milestone.paymentTermDays])).toEqual([
      ['advance', 20, 7],
      ['approvals', 30, 14],
      ['installation', 30, 14],
      ['final', 20, 14],
    ]);
    expect(garage.paymentMilestones[1]).toMatchObject({ position: 2, invoiceHint: 'po zgodzie administracji i warunkach OSD' });

    const houseOnly = byCode(list, 'house_installation_only');
    expect([houseOnly.items.length, houseOnly.procedures.length, houseOnly.paymentMilestones.length]).toEqual([3, 3, 1]);
    expect(houseOnly.paymentMilestones[0]).toMatchObject({ code: 'final', sharePercent: 100, paymentTermDays: 7 });
    for (const template of list.items) {
      expect(
        template.paymentMilestones.reduce((sum, milestone) => sum + milestone.sharePercent, 0),
        template.code,
      ).toBe(100);
    }
  });

  it('EVM-019 AC4 a process brought by two items is listed once (the same process of two items is one process of the order)', async () => {
    const list = await activeTemplates();
    const garage = byCode(list, 'garage_full_process');
    expect(garage.procedures.filter((procedure) => procedure.code === 'dso_connection')).toHaveLength(1);
    expect(byCode(list, 'house_full_package').procedures.map((procedure) => procedure.code)).toEqual([
      'dso_connection',
      'electrical_installation',
      'charger_procurement',
      'charger_installation',
      'measurements_acceptance',
    ]);
  });

  it('EVM-019 AC4 the siteTypeHint filter narrows the list; a type without templates gives an empty list', async () => {
    expect((await activeTemplates('?siteTypeHint=single_family_house')).items.map((template) => template.code)).toEqual([
      'house_full_package',
      'house_installation_only',
    ]);
    expect((await activeTemplates('?siteTypeHint=multi_family_garage')).items).toHaveLength(3);
    expect(await activeTemplates('?siteTypeHint=commercial')).toEqual({ items: [], nextCursor: null });
  });

  it('EVM-019 AC4 a value outside the SiteType vocabulary is 400 validation_failed without echoing it, unknown and repeated parameters are refused', async () => {
    const invalid = await get(`${BASE}/work-order-templates?siteTypeHint=castle_with_moat`);
    expect(invalid.status).toBe(400);
    expect(invalid.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(invalid.body).toMatchObject({
      status: 400,
      code: 'validation_failed',
      errors: [{ pointer: '/siteTypeHint', code: 'invalid_value' }],
    });
    expect(JSON.stringify(invalid.body)).not.toContain('castle_with_moat');
    for (const [query, code] of [
      ['?isActive=false', 'unknown_parameter'],
      ['?limit=5', 'unknown_parameter'],
      ['?siteTypeHint=commercial&siteTypeHint=other', 'duplicate_parameter'],
    ] as const) {
      const response = await get(`${BASE}/work-order-templates${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body, query).toMatchObject({ code });
    }
  });

  it('EVM-019 AC4 the lists of service items, process templates and document kinds follow the starting data', async () => {
    const items = (await get(`${BASE}/service-items`)).body as {
      items: Array<{ code: string; name: string; category: string; parameterSetCode: string | null; procedureTemplateCodes: string[] }>;
      nextCursor: null;
    };
    expect(items.nextCursor).toBeNull();
    expect(items.items).toHaveLength(12);
    expect(items.items[0]).toEqual({
      code: 'charger_supply',
      name: 'Dostawa ładowarki (z oferty)',
      category: 'equipment',
      parameterSetCode: 'charger_spec',
      procedureTemplateCodes: ['charger_procurement'],
    });
    expect(items.items.find((item) => item.code === 'dso_agreement')).toMatchObject({
      category: 'formal',
      parameterSetCode: 'dso_request',
      procedureTemplateCodes: ['dso_connection'],
    });
    expect(items.items.find((item) => item.code === 'custom_service')).toMatchObject({
      parameterSetCode: null,
      procedureTemplateCodes: [],
    });

    const procedures = (await get(`${BASE}/procedure-templates`)).body as {
      items: Array<{ code: string; name: string; stages: Array<Record<string, unknown>> }>;
      nextCursor: null;
    };
    expect(procedures.items).toHaveLength(10);
    const dso = procedures.items.find((procedure) => procedure.code === 'dso_connection');
    expect(dso?.stages.map((stage) => stage['code'])).toEqual([
      'power_of_attorney',
      'dso_application',
      'connection_conditions',
      'dso_agreement_signed',
      'dso_works',
      'readiness_declaration',
      'meter_connection',
    ]);
    expect(dso?.stages[2]).toEqual({
      code: 'connection_conditions',
      name: 'Warunki przyłączenia i projekt umowy',
      position: 3,
      defaultWaitingOn: 'party',
      defaultWaitingOnPartyKind: 'distribution_system_operator',
      outputDocumentKindCodes: ['connection_conditions'],
    });
    expect(dso?.stages[0]).toMatchObject({ defaultWaitingOn: 'customer', defaultWaitingOnPartyKind: null });
    expect(dso?.stages[1]).toMatchObject({ defaultWaitingOn: null, defaultWaitingOnPartyKind: null });

    const kinds = (await get(`${BASE}/document-kinds`)).body as {
      items: Array<{ code: string; confidentiality: string }>;
      nextCursor: null;
    };
    expect(kinds.items).toHaveLength(16);
    expect(kinds.items.filter((kind) => kind.confidentiality === 'identity_data').map((kind) => kind.code)).toEqual([
      'power_of_attorney',
      'dso_application',
      'dso_agreement',
      'dso_readiness_declaration',
      'customer_contract',
    ]);
    expect(kinds.items.find((kind) => kind.code === 'technical_assessment')).toEqual({
      code: 'technical_assessment',
      name: 'Ekspertyza techniczna',
      confidentiality: 'building_security',
    });
  });

  it('EVM-019 AC4 the answers carry the fields of the contract and no technical column (SR-DATA-03)', async () => {
    const allowed = new Set([
      'items',
      'nextCursor',
      'id',
      'code',
      'name',
      'siteTypeHint',
      'isActive',
      'procedures',
      'stageCount',
      'paymentMilestones',
      'position',
      'sharePercent',
      'invoiceHint',
      'paymentTermDays',
      'defaultQuantity',
      'parameterSetCode',
      'defaultParameters',
      'dedicatedCircuit',
      'internalSupplyLine',
      'category',
      'procedureTemplateCodes',
      'stages',
      'defaultWaitingOn',
      'defaultWaitingOnPartyKind',
      'outputDocumentKindCodes',
      'confidentiality',
    ]);
    const keys = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(keys)
        : typeof value === 'object' && value !== null
          ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)])
          : [];
    for (const path of OPERATIONS) {
      const found = new Set(keys((await get(path)).body));
      expect(
        [...found].filter((key) => !allowed.has(key)),
        path,
      ).toEqual([]);
    }
    const single: unknown = (await get(`${BASE}/work-order-templates/${(await activeTemplates()).items[0]?.id}`)).body;
    expect(new Set(keys(single))).not.toContain('created_by');
  });
});

describe('a retired template (EVM-019 AC5)', () => {
  it('EVM-019 AC5 a template with isActive = false is not on the list of active templates, but the by-id read returns it with isActive = false', async () => {
    const before = await activeTemplates();
    const target = byCode(before, 'garage_installation_only');
    await sql`update catalog.work_order_templates set is_active = false where id = ${target.id}`.execute(current.database.admin);

    const after = await activeTemplates();
    expect(after.items.map((template) => template.code)).toEqual(
      before.items.map((template) => template.code).filter((code) => code !== 'garage_installation_only'),
    );
    expect((await activeTemplates('?siteTypeHint=multi_family_garage')).items.map((template) => template.code)).not.toContain(
      'garage_installation_only',
    );

    const byId = await get(`${BASE}/work-order-templates/${target.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual({ ...target, isActive: false });
  });

  it('EVM-019 AC5 an unknown id is 404 not_found without details, a malformed id is 400 validation_failed without echoing it', async () => {
    const missing = await get(`${BASE}/work-order-templates/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(Object.keys(missing.body as object).sort()).toEqual(['code', 'status', 'title', 'traceId', 'type']);
    expect(missing.body).toMatchObject({ status: 404, code: 'not_found', type: '/problems/not_found' });

    const malformed = await get(`${BASE}/work-order-templates/not-a-uuid-at-all`);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/templateId' }] });
    expect(JSON.stringify(malformed.body)).not.toContain('not-a-uuid-at-all');
    const injected = await get(`${BASE}/work-order-templates/${encodeURIComponent("' or 1=1 --")}`);
    expect(injected.status).toBe(400);
  });
});

describe('who may read the configuration (EVM-019 AC7; SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  const templatePath = async (): Promise<string> => `${BASE}/work-order-templates/${(await activeTemplates()).items[0]?.id}`;

  it('EVM-019 AC7 Administrator, Editor and Read-only each get the data of every operation (200 with content)', async () => {
    const paths = [...OPERATIONS, await templatePath()];
    for (const role of ROLES) {
      for (const path of paths) {
        const response = await get(path, role);
        expect(response.status, `${role} ${path}`).toBe(200);
        expect(JSON.stringify(response.body).length, `${role} ${path}`).toBeGreaterThan(100);
      }
    }
  });

  it('EVM-019 AC7 an anonymous caller gets 401 and an account without the second step gets 403 mfa_enrollment_required', async () => {
    const paths = [...OPERATIONS, await templatePath()];
    for (const path of paths) {
      current.clock.advance(61_000);
      const anonymous = await request(server()).get(path);
      expect(anonymous.status, path).toBe(401);
      expect(anonymous.body, path).toMatchObject({ code: 'unauthenticated' });
      const waiting = await get(path, 'administrator', { state: 'mfa_enrollment' });
      expect(waiting.status, path).toBe(403);
      expect(waiting.body, path).toMatchObject({ code: 'mfa_enrollment_required' });
    }
  });

  it('EVM-019 AC7 EVM-127 AC2 the mobile channel is not allowed (web only) for any role on the operations other than the list of templates: a session of the phone in a cookie is 403, a Bearer token is 401', async () => {
    const webOnly = [...OPERATIONS.filter((path) => path !== `${BASE}/work-order-templates`), await templatePath()];
    for (const role of ['administrator', 'editor'] as const) {
      for (const path of webOnly) {
        const response = await get(path, role, { channel: 'mobile' });
        expect(response.status, `${role} ${path}`).toBe(403);
        expect(response.body, `${role} ${path}`).toMatchObject({ code: 'forbidden' });
        const phone = await phoneGet(path, role);
        expect(phone.status, `${role} ${path} bearer`).toBe(401);
        expect(phone.body, `${role} ${path} bearer`).toMatchObject({ code: 'unauthenticated' });
      }
    }
  });
});

interface Phone {
  readonly bearer: string;
  readonly deviceId: string;
  readonly sessionId: string;
}
const APP = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.2.0' };

/** A phone of the role registered through the fixtures (a Bearer token, no cookie). */
async function phoneOf(role: Role): Promise<Phone> {
  const user = await createUser(current.database.admin, current.clock, { role });
  return createMobileSession(current.database.admin, current.clock, user);
}

/** The clock moves a minute per request: the per-IP limits are not what these tests measure. */
async function phoneGet(path: string, role: Role = 'administrator', headers: Record<string, string> = APP) {
  const phone = await phoneOf(role);
  current.clock.advance(61_000);
  return request(server())
    .get(path)
    .set({ Authorization: `Bearer ${phone.bearer}`, ...headers });
}

const withToken = async (bearer: string, headers: Record<string, string> = APP) => {
  current.clock.advance(61_000);
  return request(server())
    .get(`${BASE}/work-order-templates`)
    .set({ Authorization: `Bearer ${bearer}`, ...headers });
};

describe('the list of templates for the phone (EVM-127; SR-AUTHZ-05, SR-AUTHZ-12, SR-DATA-03, SR-API-08)', () => {
  const LIST = `${BASE}/work-order-templates`;
  const endSession = (id: string) =>
    sql`update identity.sessions set revoked_at = ${current.clock.now()}, revoke_reason = 'logout' where id = ${id}`.execute(
      current.database.admin,
    );

  it('EVM-127 AC1 Administrator and Editor on the phone get 200 with exactly the content of the panel, no-store and no cookie', async () => {
    const panel = await get(LIST);
    for (const role of ['administrator', 'editor'] as const) {
      const response = await phoneGet(LIST, role);
      expect(response.status, role).toBe(200);
      expect(response.body, role).toEqual(panel.body);
      expect(zWorkOrderTemplateList.parse(response.body), role).toEqual(response.body);
      expect(response.headers['cache-control'], role).toBe('no-store');
      expect(response.headers['set-cookie'], role).toBeUndefined();
      expect(response.headers['access-control-allow-origin'], role).toBeUndefined();
    }
  });

  it('EVM-127 AC1 the filter narrows the list for the phone like for the panel, and a retired template is left out', async () => {
    const all = (await get(LIST)).body as TemplateList;
    const target = all.items.find((template) => template.siteTypeHint !== null);
    if (target === undefined) throw new Error('no template with a site type to filter by');
    const query = `?siteTypeHint=${String(target.siteTypeHint)}`;
    const filtered = await phoneGet(`${LIST}${query}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual((await get(`${LIST}${query}`)).body);
    expect((filtered.body as TemplateList).items.map((template) => template.code)).toContain(target.code);

    await sql`update catalog.work_order_templates set is_active = false where id = ${target.id}`.execute(current.database.admin);
    try {
      const after = (await phoneGet(LIST)).body as TemplateList;
      expect(after.items.map((template) => template.code)).not.toContain(target.code);
      expect(after.items.every((template) => template.isActive)).toBe(true);
    } finally {
      await sql`update catalog.work_order_templates set is_active = true where id = ${target.id}`.execute(current.database.admin);
    }
  });

  it('EVM-127 AC1 a wrong filter, an unknown and a repeated parameter are 400 on the phone as in the panel', async () => {
    const wrong = await phoneGet(`${LIST}?siteTypeHint=castle`);
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ code: 'validation_failed' });
    const unknown = await phoneGet(`${LIST}?color=red`);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'unknown_parameter' });
    const repeated = await phoneGet(`${LIST}?siteTypeHint=single_family_house&siteTypeHint=single_family_house`);
    expect(repeated.status).toBe(400);
  });

  it('EVM-127 AC2 Tylko odczyt on the phone is 403 (the sign-in of that role is refused with channel_not_allowed: EVM-094; a change to that role wipes the phone: EVM-095 AC5)', async () => {
    const response = await phoneGet(LIST, 'read_only');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
  });

  it('EVM-127 AC2 an anonymous caller is 401, a device ordered to wipe is 401 device_wipe_required, a revoked or an unknown token is 401', async () => {
    current.clock.advance(61_000);
    const anonymous = await request(server()).get(LIST).set(APP);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });

    const wiped = await phoneOf('editor');
    await setDeviceState(current, wiped.deviceId, 'wipe_required');
    const wipe = await withToken(wiped.bearer);
    expect(wipe.status).toBe(401);
    expect(wipe.body).toMatchObject({ code: 'device_wipe_required' });

    const ended = await phoneOf('administrator');
    await endSession(ended.sessionId);
    const revoked = await withToken(ended.bearer);
    expect(revoked.status).toBe(401);
    expect(revoked.body).toMatchObject({ code: 'session_revoked' });
    expect((await withToken('not-a-token')).status).toBe(401);
  });

  it('EVM-127 AC2 the panel is unchanged: the three roles get 200 without X-Client-* headers (no 426), a revoked or an expired cookie keeps its own 401', async () => {
    for (const role of ROLES) {
      expect((await get(LIST, role)).status, role).toBe(200);
    }
    const user = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const revoked = await createSession(current.database.admin, current.clock, user);
    await endSession(revoked.id);
    current.clock.advance(61_000);
    const answer = await request(server()).get(LIST).set('Cookie', revoked.cookie);
    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({ code: 'session_revoked' });

    const idle = await createSession(current.database.admin, current.clock, user);
    await sql`update identity.sessions set idle_expires_at = ${new Date(current.clock.now().getTime() - 1)} where id = ${idle.id}`.execute(
      current.database.admin,
    );
    current.clock.advance(61_000);
    const expired = await request(server()).get(LIST).set('Cookie', idle.cookie);
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ code: 'session_expired' });
  });

  it('EVM-127 AC2 the panel ignores forged or old X-Client-* headers, and a phone without them or with an old version is 426', async () => {
    const user = await createUser(current.database.admin, current.clock, { role: 'editor' });
    const session = await createSession(current.database.admin, current.clock, user);
    current.clock.advance(61_000);
    const forged = await request(server())
      .get(LIST)
      .set('Cookie', session.cookie)
      .set({ 'X-Client-Platform': 'android', 'X-Client-Version': '0.0.1' });
    expect(forged.status).toBe(200);

    for (const headers of [{}, { 'X-Client-Platform': 'android', 'X-Client-Version': '1.0.0' }]) {
      const old = await phoneGet(LIST, 'administrator', headers);
      expect(old.status, JSON.stringify(headers)).toBe(426);
      expect(old.body).toMatchObject({ code: 'client_version_unsupported' });
    }
    current.clock.advance(61_000);
    const anonymousOld = await request(server()).get(LIST).set({ 'X-Client-Platform': 'android', 'X-Client-Version': '1.0.0' });
    expect(anonymousOld.status).toBe(401);
  });

  it('EVM-127 AC3 the answer has no customer, user, amount or order data and the logs hold no token; reading is not an audit event', async () => {
    const [before] = (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows;
    const phone = await phoneOf('editor');
    const response = await withToken(phone.bearer);
    expect(response.status).toBe(200);
    // the names of the fields, not the values (a code such as `customer_charger` is catalog text): none of customer, user, amount or order data
    const keys = new Set([...JSON.stringify(response.body).matchAll(/"([A-Za-z]+)":/g)].map((match) => match[1]));
    expect([...keys].filter((key) => /customer|created|updated|email|phone|amount|workOrder|user/i.test(String(key)))).toEqual([]);
    const [after] = (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows;
    expect(after?.n).toBe(before?.n);
    expect(current.logs.text).not.toContain(phone.bearer);
    expect(current.logs.text).not.toMatch(/defaultParameters|dedicatedCircuit/);
  });
});

describe('headers and logs of the catalogue answers (SR-API-03, SR-LOG-02)', () => {
  it('EVM-019 AC4 every answer is Cache-Control: no-store (configuration is not kept by browsers or intermediaries), nosniff, JSON in UTF-8', async () => {
    const paths = [
      ...OPERATIONS,
      `${BASE}/work-order-templates/${(await activeTemplates()).items[0]?.id}`,
      `${BASE}/work-order-templates/${randomUUID()}`,
    ];
    for (const path of paths) {
      const response = await get(path);
      expect(response.headers['cache-control'], path).toBe('no-store');
      expect(response.headers['x-content-type-options'], path).toBe('nosniff');
      expect(response.headers['content-type'], path).toMatch(/^application\/(problem\+)?json; charset=utf-8$/);
      expect(response.headers['x-powered-by'], path).toBeUndefined();
    }
  });

  it('EVM-019 AC7 reading the configuration is not an audit event and the logs hold no domain object', async () => {
    const [before] = (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows;
    await get(`${BASE}/work-order-templates`);
    await get(`${BASE}/document-kinds`);
    const [after] = (await sql<{ n: string }>`select count(*)::text as n from audit.events`.execute(current.database.admin)).rows;
    expect(after?.n).toBe(before?.n);
    expect(current.logs.text).not.toMatch(/Garaż|defaultParameters|dedicatedCircuit|Pełnomocnictwo/);
  });
});
