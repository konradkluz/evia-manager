import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
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

  it('EVM-019 AC7 the mobile channel is not allowed in M1 (web only) for any role', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      for (const path of OPERATIONS) {
        const response = await get(path, role, { channel: 'mobile' });
        expect(response.status, `${role} ${path}`).toBe(403);
        expect(response.body, `${role} ${path}`).toMatchObject({ code: 'forbidden' });
      }
    }
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
