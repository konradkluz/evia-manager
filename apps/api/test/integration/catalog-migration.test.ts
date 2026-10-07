import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_SEED_2026_10 } from '../../src/migrations/data/catalog-seed-2026-10.ts';
import { validateCatalogConfig, type CatalogConfig } from '../../src/modules/catalog/domain/config-consistency.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
let app: Kysely<Database>;

beforeAll(async () => {
  database = await migratedDatabase();
  app = createDatabase({ url: database.appUrl, logger: createLogger({ level: 'fatal' }), pool: { max: 2 } });
});

afterAll(async () => {
  await app.destroy();
  await database.close();
});

const rows = async <T>(query: ReturnType<typeof sql<T>>, db: Kysely<Database> = database.admin): Promise<T[]> =>
  (await query.execute(db)).rows;
const counted = async (query: ReturnType<typeof sql<{ n: string }>>): Promise<number> => Number((await rows(query))[0]?.n);
const COUNTS = {
  serviceItems: sql<{ n: string }>`select count(*)::text as n from catalog.service_catalog_items`,
  itemProcedures: sql<{ n: string }>`select count(*)::text as n from catalog.service_catalog_item_procedures`,
  procedureTemplates: sql<{ n: string }>`select count(*)::text as n from catalog.procedure_templates`,
  stages: sql<{ n: string }>`select count(*)::text as n from catalog.procedure_stage_templates`,
  documentKinds: sql<{ n: string }>`select count(*)::text as n from catalog.document_kinds`,
  templates: sql<{ n: string }>`select count(*)::text as n from catalog.work_order_templates`,
  templateItems: sql<{ n: string }>`select count(*)::text as n from catalog.work_order_template_items`,
  milestones: sql<{ n: string }>`select count(*)::text as n from catalog.payment_milestone_templates`,
};

describe('starting data in one migration (EVM-019 AC1)', () => {
  it('EVM-019 AC1 an empty database after the migrations holds the whole catalogue of service-catalog.md', async () => {
    expect({
      serviceItems: await counted(COUNTS.serviceItems),
      itemProcedures: await counted(COUNTS.itemProcedures),
      procedureTemplates: await counted(COUNTS.procedureTemplates),
      stages: await counted(COUNTS.stages),
      documentKinds: await counted(COUNTS.documentKinds),
      templates: await counted(COUNTS.templates),
      templateItems: await counted(COUNTS.templateItems),
      milestones: await counted(COUNTS.milestones),
    }).toEqual({
      serviceItems: 12,
      itemProcedures: 11,
      procedureTemplates: 10,
      stages: 32,
      documentKinds: 16,
      templates: 5,
      templateItems: 26,
      milestones: 11,
    });
  });

  it('EVM-019 AC1 per template: items, processes brought by the items (a shared one once) and milestones match § 5', async () => {
    const shape = await rows<{ code: string; items: number; procedures: number; milestones: number; shares: number }>(sql`
      select t.code,
        (select count(*)::int from catalog.work_order_template_items i where i.work_order_template_id = t.id) as items,
        (select count(distinct ip.procedure_template_id)::int
           from catalog.work_order_template_items i
           join catalog.service_catalog_item_procedures ip on ip.catalog_item_id = i.catalog_item_id
          where i.work_order_template_id = t.id) as procedures,
        (select count(*)::int from catalog.payment_milestone_templates m where m.work_order_template_id = t.id) as milestones,
        (select sum(m.share_percent)::int from catalog.payment_milestone_templates m where m.work_order_template_id = t.id) as shares
      from catalog.work_order_templates t order by t.position`);
    expect(shape).toEqual([
      { code: 'house_full_package', items: 5, procedures: 5, milestones: 2, shares: 100 },
      { code: 'house_installation_only', items: 3, procedures: 3, milestones: 1, shares: 100 },
      { code: 'garage_full_process', items: 9, procedures: 9, milestones: 4, shares: 100 },
      { code: 'garage_installation_only', items: 7, procedures: 7, milestones: 3, shares: 100 },
      { code: 'garage_charger_installation', items: 2, procedures: 2, milestones: 1, shares: 100 },
    ]);
  });

  it('EVM-019 AC1 the rows read back from the database are consistent, with the confidentiality, waiting parties and output documents of §§ 4 and 6', async () => {
    const documentKinds = await rows<{ code: string; name: string; confidentiality: string }>(
      sql`select code, name, confidentiality from catalog.document_kinds order by position`,
    );
    expect(documentKinds).toEqual(CATALOG_SEED_2026_10.documentKinds);
    const stages = await rows<{
      procedure: string;
      code: string;
      name: string;
      waiting_on: string | null;
      party_kind: string | null;
      outputs: string[];
    }>(sql`
      select p.code as procedure, s.code, s.name, s.default_waiting_on as waiting_on, s.default_waiting_on_party_kind as party_kind,
             s.output_document_kind_codes as outputs
      from catalog.procedure_stage_templates s join catalog.procedure_templates p on p.id = s.procedure_template_id
      order by p.position, s.position`);
    expect(stages).toEqual(
      CATALOG_SEED_2026_10.procedureTemplates.flatMap((procedure) =>
        procedure.stages.map((stage) => ({
          procedure: procedure.code,
          code: stage.code,
          name: stage.name,
          waiting_on: stage.defaultWaitingOn,
          party_kind: stage.defaultWaitingOnPartyKind,
          outputs: stage.outputDocumentKindCodes,
        })),
      ),
    );
    const dangling = await rows<{ code: string }>(sql`
      select s.code from catalog.procedure_stage_templates s, unnest(s.output_document_kind_codes) as kind(code)
      where not exists (select 1 from catalog.document_kinds d where d.code = kind.code)`);
    expect(dangling).toEqual([]);

    const read: CatalogConfig = {
      documentKinds,
      procedureTemplates: await readProcedures(),
      serviceItems: await readServiceItems(),
      workOrderTemplates: await readTemplates(),
    };
    expect(validateCatalogConfig(read)).toEqual([]);
    expect(read).toEqual({
      documentKinds: CATALOG_SEED_2026_10.documentKinds,
      procedureTemplates: CATALOG_SEED_2026_10.procedureTemplates,
      serviceItems: CATALOG_SEED_2026_10.serviceItems,
      workOrderTemplates: CATALOG_SEED_2026_10.workOrderTemplates,
    });
  });

  it('EVM-019 AC1 the migration writes literal times of the frozen data and the default parameters of § 5', async () => {
    const times = await rows<{ at: string; version: number; created_by: string | null }>(
      sql`select distinct to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, version, created_by from catalog.document_kinds`,
    );
    expect(times).toEqual([{ at: '2026-10-06T00:00:00Z', version: 1, created_by: null }]);
    const parameters = await rows<{ template: string; item: string; default_parameters: unknown }>(sql`
      select t.code as template, c.code as item, i.default_parameters
      from catalog.work_order_template_items i
        join catalog.work_order_templates t on t.id = i.work_order_template_id
        join catalog.service_catalog_items c on c.id = i.catalog_item_id
      where i.default_parameters <> '{}'::jsonb order by t.position, i.position`);
    expect(parameters).toEqual([
      { template: 'house_full_package', item: 'supply_installation', default_parameters: { dedicatedCircuit: true } },
      {
        template: 'garage_full_process',
        item: 'supply_installation',
        default_parameters: { dedicatedCircuit: true, internalSupplyLine: true },
      },
      {
        template: 'garage_installation_only',
        item: 'supply_installation',
        default_parameters: { dedicatedCircuit: true, internalSupplyLine: true },
      },
    ]);
  });
});

async function readProcedures(): Promise<CatalogConfig['procedureTemplates']> {
  const procedures = await rows<{ id: string; code: string; name: string }>(
    sql`select id, code, name from catalog.procedure_templates order by position`,
  );
  const result: Array<CatalogConfig['procedureTemplates'][number]> = [];
  for (const procedure of procedures) {
    const stages = await rows<{
      code: string;
      name: string;
      defaultWaitingOn: string | null;
      defaultWaitingOnPartyKind: string | null;
      outputDocumentKindCodes: string[];
    }>(sql`
      select code, name, default_waiting_on as "defaultWaitingOn", default_waiting_on_party_kind as "defaultWaitingOnPartyKind",
             output_document_kind_codes as "outputDocumentKindCodes"
      from catalog.procedure_stage_templates where procedure_template_id = ${procedure.id} order by position`);
    result.push({ code: procedure.code, name: procedure.name, stages });
  }
  return result;
}

async function readServiceItems(): Promise<CatalogConfig['serviceItems']> {
  const items = await rows<{ id: string; code: string; name: string; category: string; parameterSetCode: string | null }>(
    sql`select id, code, name, category, parameter_set_code as "parameterSetCode" from catalog.service_catalog_items order by position`,
  );
  const result: Array<CatalogConfig['serviceItems'][number]> = [];
  for (const item of items) {
    const procedures = await rows<{ code: string }>(sql`
      select p.code from catalog.service_catalog_item_procedures ip join catalog.procedure_templates p on p.id = ip.procedure_template_id
      where ip.catalog_item_id = ${item.id} order by ip.position`);
    result.push({
      code: item.code,
      name: item.name,
      category: item.category,
      parameterSetCode: item.parameterSetCode,
      procedureTemplateCodes: procedures.map((procedure) => procedure.code),
    });
  }
  return result;
}

async function readTemplates(): Promise<CatalogConfig['workOrderTemplates']> {
  const templates = await rows<{ id: string; code: string; name: string; siteTypeHint: string | null }>(
    sql`select id, code, name, site_type_hint as "siteTypeHint" from catalog.work_order_templates order by position`,
  );
  const result: Array<CatalogConfig['workOrderTemplates'][number]> = [];
  for (const template of templates) {
    const items = await rows<{ serviceItemCode: string; defaultQuantity: number; defaultParameters: Record<string, unknown> }>(sql`
      select c.code as "serviceItemCode", i.default_quantity as "defaultQuantity", i.default_parameters as "defaultParameters"
      from catalog.work_order_template_items i join catalog.service_catalog_items c on c.id = i.catalog_item_id
      where i.work_order_template_id = ${template.id} order by i.position`);
    const paymentMilestones = await rows<{
      code: string;
      name: string;
      sharePercent: number;
      invoiceHint: string;
      paymentTermDays: number;
    }>(sql`
      select code, name, share_percent as "sharePercent", invoice_hint as "invoiceHint", payment_term_days as "paymentTermDays"
      from catalog.payment_milestone_templates where work_order_template_id = ${template.id} order by position`);
    result.push({ code: template.code, name: template.name, siteTypeHint: template.siteTypeHint, items, paymentMilestones });
  }
  return result;
}

describe('constraints of the catalogue tables (EVM-019 AC2, AC3; SR-INPUT-02)', () => {
  const rejected = async (statement: ReturnType<typeof sql>, code: string) => {
    await expect(statement.execute(database.admin)).rejects.toMatchObject({ code });
  };
  const at = new Date('2026-10-06T00:00:00Z');
  const documentKind = (code: string) =>
    sql`insert into catalog.document_kinds (code, name, confidentiality, position, created_at, updated_at) values (${code}, 'Probe', 'standard', 99, ${at}, ${at})`;

  it('EVM-019 AC3 a code outside ^[a-z][a-z0-9_]{1,63}$ is refused by the database on every code column (23514)', async () => {
    for (const bad of ['Bad', '1x', 'a', 'a-b', 'a b', `a${'b'.repeat(64)}`]) await rejected(documentKind(bad), '23514');
    await rejected(
      sql`insert into catalog.procedure_stage_templates (procedure_template_id, code, name, position, created_at, updated_at)
          values ((select id from catalog.procedure_templates limit 1), 'Bad-Stage', 'Probe', 9, ${at}, ${at})`,
      '23514',
    );
    await rejected(
      sql`insert into catalog.payment_milestone_templates (work_order_template_id, code, name, position, share_percent, invoice_hint, payment_term_days, created_at, updated_at)
          values ((select id from catalog.work_order_templates limit 1), 'BAD', 'Probe', 9, 10, 'hint', 7, ${at}, ${at})`,
      '23514',
    );
    await rejected(
      sql`insert into catalog.procedure_stage_templates (procedure_template_id, code, name, position, output_document_kind_codes, created_at, updated_at)
          values ((select id from catalog.procedure_templates limit 1), 'probe_stage', 'Probe', 9, ${['ok_code', 'Not Ok']}::text[], ${at}, ${at})`,
      '23514',
    );
  });

  it('EVM-019 AC3 a share outside 1..100, an unknown vocabulary value and a party kind without a waiting party are refused', async () => {
    const milestone = (share: number) =>
      sql`insert into catalog.payment_milestone_templates (work_order_template_id, code, name, position, share_percent, invoice_hint, payment_term_days, created_at, updated_at)
          values ((select id from catalog.work_order_templates limit 1), 'probe_share', 'Probe', 9, ${share}, 'hint', 7, ${at}, ${at})`;
    await rejected(milestone(0), '23514');
    await rejected(milestone(101), '23514');
    await rejected(
      sql`insert into catalog.document_kinds (code, name, confidentiality, position, created_at, updated_at) values ('probe_kind', 'Probe', 'secret', 99, ${at}, ${at})`,
      '23514',
    );
    await rejected(
      sql`insert into catalog.procedure_stage_templates (procedure_template_id, code, name, position, default_waiting_on_party_kind, created_at, updated_at)
          values ((select id from catalog.procedure_templates limit 1), 'probe_stage', 'Probe', 9, 'supplier', ${at}, ${at})`,
      '23514',
    );
    await rejected(
      sql`insert into catalog.procedure_stage_templates (procedure_template_id, code, name, position, default_waiting_on, created_at, updated_at)
          values ((select id from catalog.procedure_templates limit 1), 'probe_stage', 'Probe', 9, 'party', ${at}, ${at})`,
      '23514',
    );
  });

  it('EVM-019 AC2 default parameters must be a JSON object of at most 16 KB measured in UTF-8 bytes (not in compressed bytes)', async () => {
    const item = (parameters: string) =>
      sql`insert into catalog.work_order_template_items (work_order_template_id, catalog_item_id, position, default_parameters, created_at, updated_at)
          values ((select id from catalog.work_order_templates where code = 'garage_charger_installation'),
                  (select id from catalog.service_catalog_items where code = 'custom_service'), 9, ${parameters}::jsonb, ${at}, ${at})`;
    await rejected(item('[]'), '23514');
    await rejected(item('"text"'), '23514');
    // 6000 repeated 3-byte characters compress to a few dozen bytes in TOAST (pg_column_size would pass them), but are 18 000 bytes of text.
    await rejected(item(JSON.stringify({ filler: '€'.repeat(6000) })), '23514');
    await rejected(item(JSON.stringify({ filler: 'x'.repeat(16_400) })), '23514');
    await expect(item(JSON.stringify({ filler: 'x'.repeat(16_000) })).execute(database.admin)).resolves.toBeDefined();
  });

  it('EVM-019 AC3 a template cannot use the same position or the same item twice', async () => {
    await rejected(
      sql`insert into catalog.work_order_template_items (work_order_template_id, catalog_item_id, position, created_at, updated_at)
          values ((select id from catalog.work_order_templates where code = 'garage_charger_installation'),
                  (select id from catalog.service_catalog_items where code = 'charger_supply'), 8, ${at}, ${at})`,
      '23505',
    );
  });
});

describe('the application role only reads the configuration (EVM-019 AC6; SR-AUTHZ-01)', () => {
  const TABLES = [
    'catalog.document_kinds',
    'catalog.payment_milestone_templates',
    'catalog.procedure_stage_templates',
    'catalog.procedure_templates',
    'catalog.service_catalog_item_procedures',
    'catalog.service_catalog_items',
    'catalog.work_order_template_items',
    'catalog.work_order_templates',
  ];

  it('EVM-019 AC6 every table of the schema has SELECT for evia_app and nothing else, no default privileges, nothing for PUBLIC', async () => {
    const tables = await rows<{ name: string }>(sql`
      select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'catalog' and c.relkind in ('r', 'p', 'v', 'm', 'S') order by 1`);
    expect(tables.map((table) => table.name)).toEqual(TABLES);
    for (const table of TABLES) {
      const granted: Record<string, boolean> = {};
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const [found] = await rows<{ allowed: boolean }>(sql`select has_table_privilege('evia_it_app', ${table}, ${privilege}) as allowed`);
        granted[privilege] = found?.allowed ?? false;
      }
      expect(granted, table).toEqual({
        SELECT: true,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
      });
      const [publicAccess] = await rows<{ allowed: boolean }>(sql`select has_table_privilege('public', ${table}, 'SELECT') as allowed`);
      expect(publicAccess?.allowed, `${table} for PUBLIC`).toBe(false);
    }
    const [schema] = await rows<{ usage: boolean; create: boolean; publicUsage: boolean }>(sql`
      select has_schema_privilege('evia_it_app', 'catalog', 'USAGE') as usage, has_schema_privilege('evia_it_app', 'catalog', 'CREATE') as create,
             has_schema_privilege('public', 'catalog', 'USAGE') as "publicUsage"`);
    expect(schema).toEqual({ usage: true, create: false, publicUsage: false });
    const [defaults] = await rows<{ n: string }>(
      sql`select count(*)::text as n from pg_default_acl where defaclnamespace = (select oid from pg_namespace where nspname = 'catalog')`,
    );
    expect(defaults?.n).toBe('0');
  });

  it('EVM-019 AC6 INSERT, UPDATE, DELETE and TRUNCATE as evia_app fail with permission denied (42501) while SELECT works', async () => {
    const [read] = await rows<{ n: string }>(sql`select count(*)::text as n from catalog.work_order_templates`, app);
    expect(read?.n).toBe('5');
    const at = new Date('2026-10-06T00:00:00Z');
    for (const attempt of [
      sql`insert into catalog.document_kinds (code, name, confidentiality, position, created_at, updated_at) values ('probe_kind', 'Probe', 'standard', 99, ${at}, ${at})`,
      sql`update catalog.work_order_templates set is_active = false`,
      sql`update catalog.service_catalog_items set name = 'changed'`,
      sql`delete from catalog.payment_milestone_templates`,
      sql`truncate catalog.work_order_template_items`,
      sql`create table catalog.other (id int)`,
      sql`drop table catalog.document_kinds`,
    ]) {
      await expect(attempt.execute(app)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await counted(COUNTS.templates)).toBe(5);
  });
});
