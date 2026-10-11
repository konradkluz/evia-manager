import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogItemDirectoryService } from '../../src/modules/catalog/application/catalog-item-directory.service.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

const directory = new CatalogItemDirectoryService();
const admin = () => database.admin;

describe('the facade of the catalogue for the scope of an order (EVM-035 AC2, AC4; ADR-0001)', () => {
  it('EVM-035 AC2 an active item is found by its stable code with the set of its parameters and the codes of the processes it brings, in order', async () => {
    const item = await directory.findActiveByCode(admin(), 'supply_installation');
    expect(item).toMatchObject({
      code: 'supply_installation',
      name: 'Instalacja zasilająca (obwód dedykowany lub istniejący)',
      parameterSetCode: 'supply_circuit',
      procedureCodes: ['electrical_installation'],
    });
    expect(item?.id).toMatch(/^[0-9a-f-]{36}$/);
    const custom = await directory.findActiveByCode(admin(), 'custom_service');
    expect(custom).toMatchObject({ code: 'custom_service', parameterSetCode: null, procedureCodes: [] });
  });

  it('EVM-035 AC4 a code that does not exist, an item that is retired and one that is deleted are ONE answer: undefined', async () => {
    expect(await directory.findActiveByCode(admin(), 'no_such_item')).toBeUndefined();
    await sql`update catalog.service_catalog_items set is_active = false where code = 'technical_assessment'`.execute(admin());
    try {
      expect(await directory.findActiveByCode(admin(), 'technical_assessment')).toBeUndefined();
    } finally {
      await sql`update catalog.service_catalog_items set is_active = true where code = 'technical_assessment'`.execute(admin());
    }
    await sql`update catalog.service_catalog_items set deleted_at = now() where code = 'fire_safety_opinion'`.execute(admin());
    try {
      expect(await directory.findActiveByCode(admin(), 'fire_safety_opinion')).toBeUndefined();
    } finally {
      await sql`update catalog.service_catalog_items set deleted_at = null where code = 'fire_safety_opinion'`.execute(admin());
    }
  });

  it('EVM-035 AC2 a process template that is retired or deleted is not brought by the item', async () => {
    await sql`update catalog.procedure_templates set is_active = false where code = 'dso_connection'`.execute(admin());
    try {
      expect((await directory.findActiveByCode(admin(), 'dso_agreement'))?.procedureCodes).toEqual([]);
    } finally {
      await sql`update catalog.procedure_templates set is_active = true where code = 'dso_connection'`.execute(admin());
    }
    expect((await directory.findActiveByCode(admin(), 'dso_agreement'))?.procedureCodes).toEqual(['dso_connection']);
  });

  it('EVM-035 AC2 the processes of an item come with their stages in order, a copy ready for the order; an item without processes brings none', async () => {
    const item = await directory.findActiveByCode(admin(), 'supply_installation');
    const procedures = await directory.findProcedures(admin(), item?.id ?? '');
    expect(procedures).toHaveLength(1);
    expect(procedures[0]).toMatchObject({
      code: 'electrical_installation',
      name: 'Instalacja zasilająca',
      broughtByCatalogItemId: item?.id,
    });
    expect(procedures[0]?.stages.map((stage) => [stage.position, stage.code])).toEqual([
      [1, 'site_survey'],
      [2, 'installation_work'],
      [3, 'protection_connection'],
    ]);
    expect(procedures[0]?.sourceProcedureTemplateId).toMatch(/^[0-9a-f-]{36}$/);
    const custom = await directory.findActiveByCode(admin(), 'custom_service');
    expect(await directory.findProcedures(admin(), custom?.id ?? '')).toEqual([]);
  });

  it('EVM-035 AC2 a process whose stages are all deleted is still brought, with no stages (the planner copies what there is)', async () => {
    const item = await directory.findActiveByCode(admin(), 'technical_assessment');
    await sql`update catalog.procedure_stage_templates set deleted_at = now()
      where procedure_template_id in (select id from catalog.procedure_templates where code = 'technical_assessment')`.execute(admin());
    try {
      const procedures = await directory.findProcedures(admin(), item?.id ?? '');
      expect(procedures).toHaveLength(1);
      expect(procedures[0]?.stages).toEqual([]);
    } finally {
      await sql`update catalog.procedure_stage_templates set deleted_at = null
        where procedure_template_id in (select id from catalog.procedure_templates where code = 'technical_assessment')`.execute(admin());
    }
  });
});
