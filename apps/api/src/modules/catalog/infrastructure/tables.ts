/**
 * Kysely types of the tables the `catalog` module owns (EVM-019). Only the columns the module reads are declared — the
 * application role has SELECT and nothing else on this schema, so there is no insert or update type. `platform` does not
 * know module tables: the module narrows a handle with `db.$extendTables<CatalogTables>()`.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

interface Retired {
  deleted_at: Date | null;
}

export interface DocumentKindsTable extends Retired {
  code: string;
  name: string;
  confidentiality: 'identity_data' | 'building_security' | 'standard';
  position: number;
}

export interface ProcedureTemplatesTable extends Retired {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  position: number;
}

export interface ProcedureStageTemplatesTable extends Retired {
  procedure_template_id: string;
  code: string;
  name: string;
  position: number;
  default_waiting_on: 'customer' | 'party' | null;
  default_waiting_on_party_kind: string | null;
  output_document_kind_codes: string[];
}

export interface ServiceCatalogItemsTable extends Retired {
  id: string;
  code: string;
  name: string;
  category: string;
  parameter_set_code: string | null;
  is_active: boolean;
  position: number;
}

export interface ServiceCatalogItemProceduresTable extends Retired {
  catalog_item_id: string;
  procedure_template_id: string;
  position: number;
}

export interface WorkOrderTemplatesTable extends Retired {
  id: string;
  code: string;
  name: string;
  site_type_hint: string | null;
  is_active: boolean;
  position: number;
}

export interface WorkOrderTemplateItemsTable extends Retired {
  work_order_template_id: string;
  catalog_item_id: string;
  position: number;
  default_quantity: number;
  default_parameters: Record<string, string | number | boolean>;
}

export interface PaymentMilestoneTemplatesTable extends Retired {
  work_order_template_id: string;
  code: string;
  name: string;
  position: number;
  share_percent: number;
  invoice_hint: string;
  payment_term_days: number;
}

export type CatalogTables = {
  'catalog.document_kinds': DocumentKindsTable;
  'catalog.procedure_templates': ProcedureTemplatesTable;
  'catalog.procedure_stage_templates': ProcedureStageTemplatesTable;
  'catalog.service_catalog_items': ServiceCatalogItemsTable;
  'catalog.service_catalog_item_procedures': ServiceCatalogItemProceduresTable;
  'catalog.work_order_templates': WorkOrderTemplatesTable;
  'catalog.work_order_template_items': WorkOrderTemplateItemsTable;
  'catalog.payment_milestone_templates': PaymentMilestoneTemplatesTable;
};

/** A handle (pool or transaction) narrowed to the catalog tables. */
export type CatalogDb = Kysely<CatalogTables>;

export const catalogTables = (db: Kysely<Database>): CatalogDb => db.$extendTables<CatalogTables>();
