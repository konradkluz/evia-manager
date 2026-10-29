/**
 * The registry of the synchronised tables (ADR-0021 D4; EVM-096 AC1): the types the change log knows, the table each is read from and the column that holds
 * the anchor order. A test keeps it equal to the triggers `sync.record_change` in `pg_trigger` and makes every table of the modules in scope appear here or in
 * {@link SYNC_EXCLUDED_TABLES} with a reason: a new table without a decision turns it red (fail closed).
 */
export interface SyncedEntity {
  readonly type: 'work_order' | 'customer' | 'site';
  readonly table: string;
  /** The column that names the anchor order of a row; empty when the entity has none (customers, sites). */
  readonly anchorColumn: string;
}

export const SYNCED_ENTITIES: readonly SyncedEntity[] = Object.freeze([
  { type: 'work_order', table: 'work_orders.work_orders', anchorColumn: 'id' },
  { type: 'customer', table: 'customers.customers', anchorColumn: '' },
  { type: 'site', table: 'sites.sites', anchorColumn: '' },
]);

/** The schemas whose tables are candidates for the phone (ADR-0021 D4). */
export const SYNC_SCOPE_SCHEMAS: readonly string[] = Object.freeze([
  'work_orders',
  'customers',
  'sites',
  'parties',
  'procedures',
  'timeline',
  'catalog',
]);

const LATER = 'a synchronised entity of EVM-097 (the remaining types and the scope): the trigger arrives with its projection';
const CATALOGUE = 'catalogue of the office; reaches the phone with the catalogue snapshot of EVM-097';

/** Tables of the scope schemas that are deliberately NOT synchronised (yet), each with the reason. */
export const SYNC_EXCLUDED_TABLES: Readonly<Record<string, string>> = Object.freeze({
  'work_orders.number_counters': 'technical table of the numbering of orders, never on the phone',
  'work_orders.scope_items': LATER,
  'work_orders.work_order_assignments': LATER,
  'parties.parties': LATER,
  'procedures.procedures': LATER,
  'procedures.procedure_stages': LATER,
  'timeline.timeline_entries': LATER,
  'catalog.document_kinds': CATALOGUE,
  'catalog.payment_milestone_templates': 'not on the phone (payments are outside the projection)',
  'catalog.procedure_stage_templates': CATALOGUE,
  'catalog.procedure_templates': CATALOGUE,
  'catalog.service_catalog_item_procedures': CATALOGUE,
  'catalog.service_catalog_items': CATALOGUE,
  'catalog.work_order_template_items': CATALOGUE,
  'catalog.work_order_templates': CATALOGUE,
});
