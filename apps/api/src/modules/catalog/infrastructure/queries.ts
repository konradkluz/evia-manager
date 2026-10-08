/**
 * Queries of the `catalog` module (Kysely builder only, every value bound — SR-INPUT-03): read only, which is all the
 * application role can do on this schema (EVM-019 AC6). Every query names its columns (no `select *`, so a technical
 * column such as `created_by` can never reach a response — SR-DATA-03), skips retired rows (`deleted_at`) and is bounded
 * by `MAX_LIST_ITEMS` (the sets are small and returned whole).
 */
import { MAX_LIST_ITEMS } from '../domain/vocabularies.ts';
import type { TemplateForCopy } from '../template-directory.ts';
import type { CatalogDb } from './tables.ts';

export interface DocumentKindRow {
  readonly code: string;
  readonly name: string;
  readonly confidentiality: string;
}

export interface StageRow {
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly defaultWaitingOn: string | null;
  readonly defaultWaitingOnPartyKind: string | null;
  readonly outputDocumentKindCodes: readonly string[];
}

export interface ProcedureTemplateRow {
  readonly code: string;
  readonly name: string;
  readonly stages: readonly StageRow[];
}

export interface ServiceItemRow {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly parameterSetCode: string | null;
  readonly procedureTemplateCodes: readonly string[];
}

export interface TemplateItemRow {
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly defaultQuantity: number;
  readonly parameterSetCode: string | null;
  readonly defaultParameters: Readonly<Record<string, string | number | boolean>>;
}

export interface TemplateProcedureRow {
  readonly code: string;
  readonly name: string;
  readonly stageCount: number;
}

export interface MilestoneRow {
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly sharePercent: number;
  readonly invoiceHint: string;
  readonly paymentTermDays: number;
}

export interface WorkOrderTemplateRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly siteTypeHint: string | null;
  readonly isActive: boolean;
  readonly items: readonly TemplateItemRow[];
  /** Brought by the items, in order, a shared process more than once (the domain makes them distinct). */
  readonly procedures: readonly TemplateProcedureRow[];
  readonly paymentMilestones: readonly MilestoneRow[];
}

export interface TemplateFilter {
  /** Set for the by-id read, which returns a retired template too (AC5). */
  readonly id?: string;
  readonly activeOnly: boolean;
  readonly siteTypeHint?: string;
}

/** Groups rows by a key, keeping the order the rows came in. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

export function listDocumentKinds(db: CatalogDb): Promise<DocumentKindRow[]> {
  return db
    .selectFrom('catalog.document_kinds')
    .select(['code', 'name', 'confidentiality'])
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .limit(MAX_LIST_ITEMS)
    .execute();
}

export async function listProcedureTemplates(db: CatalogDb): Promise<ProcedureTemplateRow[]> {
  const procedures = await db
    .selectFrom('catalog.procedure_templates')
    .select(['id', 'code', 'name'])
    .where('deleted_at', 'is', null)
    .where('is_active', '=', true)
    .orderBy('position')
    .limit(MAX_LIST_ITEMS)
    .execute();
  const stages = await db
    .selectFrom('catalog.procedure_stage_templates as stage')
    .innerJoin('catalog.procedure_templates as procedure', 'procedure.id', 'stage.procedure_template_id')
    .select([
      'stage.procedure_template_id as procedureId',
      'stage.code',
      'stage.name',
      'stage.position',
      'stage.default_waiting_on as defaultWaitingOn',
      'stage.default_waiting_on_party_kind as defaultWaitingOnPartyKind',
      'stage.output_document_kind_codes as outputDocumentKindCodes',
    ])
    .where('stage.deleted_at', 'is', null)
    .where('procedure.deleted_at', 'is', null)
    .where('procedure.is_active', '=', true)
    .orderBy('procedure.position')
    .orderBy('stage.position')
    .execute();
  const byProcedure = groupBy(stages, (stage) => stage.procedureId);
  return procedures.map((procedure) => ({
    code: procedure.code,
    name: procedure.name,
    stages: (byProcedure.get(procedure.id) ?? []).map((stage) => ({
      code: stage.code,
      name: stage.name,
      position: stage.position,
      defaultWaitingOn: stage.defaultWaitingOn,
      defaultWaitingOnPartyKind: stage.defaultWaitingOnPartyKind,
      outputDocumentKindCodes: stage.outputDocumentKindCodes,
    })),
  }));
}

export async function listServiceItems(db: CatalogDb): Promise<ServiceItemRow[]> {
  const items = await db
    .selectFrom('catalog.service_catalog_items')
    .select(['id', 'code', 'name', 'category', 'parameter_set_code as parameterSetCode'])
    .where('deleted_at', 'is', null)
    .where('is_active', '=', true)
    .orderBy('position')
    .limit(MAX_LIST_ITEMS)
    .execute();
  const links = await db
    .selectFrom('catalog.service_catalog_item_procedures as link')
    .innerJoin('catalog.procedure_templates as procedure', 'procedure.id', 'link.procedure_template_id')
    .innerJoin('catalog.service_catalog_items as item', 'item.id', 'link.catalog_item_id')
    .select(['link.catalog_item_id as itemId', 'procedure.code'])
    .where('link.deleted_at', 'is', null)
    .where('procedure.deleted_at', 'is', null)
    .where('item.deleted_at', 'is', null)
    .where('item.is_active', '=', true)
    .orderBy('item.position')
    .orderBy('link.position')
    .execute();
  const byItem = groupBy(links, (link) => link.itemId);
  return items.map(({ id, ...item }) => ({ ...item, procedureTemplateCodes: (byItem.get(id) ?? []).map((link) => link.code) }));
}

/** Work order templates with the preview of AC4: items, brought processes with their stage count, payment plan. */
export async function findWorkOrderTemplates(db: CatalogDb, filter: TemplateFilter): Promise<WorkOrderTemplateRow[]> {
  let query = db
    .selectFrom('catalog.work_order_templates')
    .select(['id', 'code', 'name', 'site_type_hint as siteTypeHint', 'is_active as isActive'])
    .where('deleted_at', 'is', null);
  if (filter.id !== undefined) query = query.where('id', '=', filter.id);
  if (filter.activeOnly) query = query.where('is_active', '=', true);
  if (filter.siteTypeHint !== undefined) query = query.where('site_type_hint', '=', filter.siteTypeHint);
  const templates = await query.orderBy('position').limit(MAX_LIST_ITEMS).execute();
  if (templates.length === 0) return [];
  const ids = templates.map((template) => template.id);

  const items = await db
    .selectFrom('catalog.work_order_template_items as item')
    .innerJoin('catalog.service_catalog_items as service', 'service.id', 'item.catalog_item_id')
    .select([
      'item.work_order_template_id as templateId',
      'service.code',
      'service.name',
      'item.position',
      'item.default_quantity as defaultQuantity',
      'service.parameter_set_code as parameterSetCode',
      'item.default_parameters as defaultParameters',
    ])
    .where('item.deleted_at', 'is', null)
    .where('service.deleted_at', 'is', null)
    .where('item.work_order_template_id', 'in', ids)
    .orderBy('item.work_order_template_id')
    .orderBy('item.position')
    .execute();

  const brought = await db
    .selectFrom('catalog.work_order_template_items as item')
    .innerJoin('catalog.service_catalog_item_procedures as link', 'link.catalog_item_id', 'item.catalog_item_id')
    .innerJoin('catalog.procedure_templates as procedure', 'procedure.id', 'link.procedure_template_id')
    .select((eb) => [
      'item.work_order_template_id as templateId',
      'procedure.code',
      'procedure.name',
      eb
        .selectFrom('catalog.procedure_stage_templates as stage')
        .select((stageEb) => stageEb.fn.countAll<string>().as('count'))
        .whereRef('stage.procedure_template_id', '=', 'procedure.id')
        .where('stage.deleted_at', 'is', null)
        .as('stageCount'),
    ])
    .where('item.deleted_at', 'is', null)
    .where('link.deleted_at', 'is', null)
    .where('procedure.deleted_at', 'is', null)
    .where('item.work_order_template_id', 'in', ids)
    .orderBy('item.work_order_template_id')
    .orderBy('item.position')
    .orderBy('link.position')
    .execute();

  const milestones = await db
    .selectFrom('catalog.payment_milestone_templates')
    .select([
      'work_order_template_id as templateId',
      'code',
      'name',
      'position',
      'share_percent as sharePercent',
      'invoice_hint as invoiceHint',
      'payment_term_days as paymentTermDays',
    ])
    .where('deleted_at', 'is', null)
    .where('work_order_template_id', 'in', ids)
    .orderBy('work_order_template_id')
    .orderBy('position')
    .execute();

  const itemsOf = groupBy(items, (row) => row.templateId);
  const broughtBy = groupBy(brought, (row) => row.templateId);
  const milestonesOf = groupBy(milestones, (row) => row.templateId);
  return templates.map((template) => ({
    ...template,
    items: (itemsOf.get(template.id) ?? []).map((item) => ({
      code: item.code,
      name: item.name,
      position: item.position,
      defaultQuantity: item.defaultQuantity,
      parameterSetCode: item.parameterSetCode,
      defaultParameters: item.defaultParameters,
    })),
    procedures: (broughtBy.get(template.id) ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      stageCount: Number(row.stageCount),
    })),
    paymentMilestones: (milestonesOf.get(template.id) ?? []).map((milestone) => ({
      code: milestone.code,
      name: milestone.name,
      position: milestone.position,
      sharePercent: milestone.sharePercent,
      invoiceHint: milestone.invoiceHint,
      paymentTermDays: milestone.paymentTermDays,
    })),
  }));
}

/**
 * An ACTIVE, not deleted template with the items a new work order copies (EVM-022): the same items, in the same order, as the
 * preview of the card ("9 pozycji") — an item whose service is deleted is not copied, so the scope matches what the user saw.
 * `undefined` for a template that is missing, retired or deleted.
 */
export async function findActiveTemplateItems(db: CatalogDb, id: string): Promise<TemplateForCopy | undefined> {
  const template = await db
    .selectFrom('catalog.work_order_templates')
    .select(['id', 'name'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (template === undefined) return undefined;
  const items = await db
    .selectFrom('catalog.work_order_template_items as item')
    .innerJoin('catalog.service_catalog_items as service', 'service.id', 'item.catalog_item_id')
    .select([
      'item.catalog_item_id as catalogItemId',
      'item.position',
      'service.code',
      'service.name',
      'service.parameter_set_code as parameterSetCode',
      'item.default_quantity as quantity',
      'item.default_parameters as parameters',
    ])
    .where('item.work_order_template_id', '=', id)
    .where('item.deleted_at', 'is', null)
    .where('service.deleted_at', 'is', null)
    .orderBy('item.position')
    .limit(MAX_LIST_ITEMS)
    .execute();
  return { id: template.id, name: template.name, items };
}
