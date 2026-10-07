/**
 * 0008 — starting data of the catalogue (EVM-019 AC1): the service catalogue, process templates with stages, document
 * kinds with the confidentiality class, work order templates with items and payment plans, as accepted in
 * docs/product/service-catalog.md. One data migration for the whole catalogue. The data is the frozen copy
 * `data/catalog-seed-2026-10.ts` (not the module: a later change of the module's code must not change what this migration
 * writes); a change of the starting data is a NEW data migration (AC6). Rules:
 * - every value is a bound parameter of an `sql` template — no `sql.raw`, no dynamic identifiers;
 * - the times are the literal of the frozen data, never `now()` (migrations do not read the database clock);
 * - the rows reference each other by `code` (a sub-select), not by an identifier the migration would have to invent;
 * - an empty database is assumed: a code that already exists makes the migration fail (it is not an upsert).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';
import { CATALOG_SEED_2026_10, type CatalogSeed } from './data/catalog-seed-2026-10.ts';

async function seedDocumentKinds(db: Kysely<Database>, seed: CatalogSeed, at: Date): Promise<void> {
  for (const [index, kind] of seed.documentKinds.entries()) {
    await sql`
      insert into catalog.document_kinds (code, name, confidentiality, position, created_at, updated_at)
      values (${kind.code}, ${kind.name}, ${kind.confidentiality}, ${index + 1}, ${at}, ${at})
    `.execute(db);
  }
}

async function seedProcedureTemplates(db: Kysely<Database>, seed: CatalogSeed, at: Date): Promise<void> {
  for (const [index, procedure] of seed.procedureTemplates.entries()) {
    await sql`
      insert into catalog.procedure_templates (code, name, position, created_at, updated_at)
      values (${procedure.code}, ${procedure.name}, ${index + 1}, ${at}, ${at})
    `.execute(db);
    for (const [position, stage] of procedure.stages.entries()) {
      await sql`
        insert into catalog.procedure_stage_templates (
          procedure_template_id, code, name, position, default_waiting_on, default_waiting_on_party_kind,
          output_document_kind_codes, created_at, updated_at
        )
        values (
          (select id from catalog.procedure_templates where code = ${procedure.code}), ${stage.code}, ${stage.name},
          ${position + 1}, ${stage.defaultWaitingOn}, ${stage.defaultWaitingOnPartyKind},
          ${stage.outputDocumentKindCodes}::text[], ${at}, ${at}
        )
      `.execute(db);
    }
  }
}

async function seedServiceItems(db: Kysely<Database>, seed: CatalogSeed, at: Date): Promise<void> {
  for (const [index, item] of seed.serviceItems.entries()) {
    await sql`
      insert into catalog.service_catalog_items (code, name, category, parameter_set_code, position, created_at, updated_at)
      values (${item.code}, ${item.name}, ${item.category}, ${item.parameterSetCode}, ${index + 1}, ${at}, ${at})
    `.execute(db);
    for (const [position, procedureCode] of item.procedureTemplateCodes.entries()) {
      await sql`
        insert into catalog.service_catalog_item_procedures (catalog_item_id, procedure_template_id, position, created_at, updated_at)
        values (
          (select id from catalog.service_catalog_items where code = ${item.code}),
          (select id from catalog.procedure_templates where code = ${procedureCode}),
          ${position + 1}, ${at}, ${at}
        )
      `.execute(db);
    }
  }
}

async function seedWorkOrderTemplates(db: Kysely<Database>, seed: CatalogSeed, at: Date): Promise<void> {
  for (const [index, template] of seed.workOrderTemplates.entries()) {
    await sql`
      insert into catalog.work_order_templates (code, name, site_type_hint, position, created_at, updated_at)
      values (${template.code}, ${template.name}, ${template.siteTypeHint}, ${index + 1}, ${at}, ${at})
    `.execute(db);
    for (const [position, item] of template.items.entries()) {
      await sql`
        insert into catalog.work_order_template_items (
          work_order_template_id, catalog_item_id, position, default_quantity, default_parameters, created_at, updated_at
        )
        values (
          (select id from catalog.work_order_templates where code = ${template.code}),
          (select id from catalog.service_catalog_items where code = ${item.serviceItemCode}),
          ${position + 1}, ${item.defaultQuantity}, ${JSON.stringify(item.defaultParameters)}::jsonb, ${at}, ${at}
        )
      `.execute(db);
    }
    for (const [position, milestone] of template.paymentMilestones.entries()) {
      await sql`
        insert into catalog.payment_milestone_templates (
          work_order_template_id, code, name, position, share_percent, invoice_hint, payment_term_days, created_at, updated_at
        )
        values (
          (select id from catalog.work_order_templates where code = ${template.code}), ${milestone.code}, ${milestone.name},
          ${position + 1}, ${milestone.sharePercent}, ${milestone.invoiceHint}, ${milestone.paymentTermDays}, ${at}, ${at}
        )
      `.execute(db);
    }
  }
}

export async function up(db: Kysely<Database>): Promise<void> {
  const seed = CATALOG_SEED_2026_10;
  const at = new Date(seed.seededAt);
  await seedDocumentKinds(db, seed, at);
  await seedProcedureTemplates(db, seed, at);
  await seedServiceItems(db, seed, at);
  await seedWorkOrderTemplates(db, seed, at);
}
