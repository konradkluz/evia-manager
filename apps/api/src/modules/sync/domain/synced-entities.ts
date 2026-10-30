/**
 * The registry of the synchronised tables (ADR-0021 D4; EVM-096 AC1): the types the change log knows, the table each is read from and the column that holds
 * the anchor order. A test keeps it equal to the triggers `sync.record_change` in `pg_trigger` and makes every table of the modules in scope appear here or in
 * {@link SYNC_EXCLUDED_TABLES} with a reason: a new table without a decision turns it red (fail closed).
 */
export interface SyncedEntity {
  readonly type: 'work_order' | 'customer' | 'site' | 'party' | 'scope_item' | 'procedure_stage' | 'timeline_entry' | 'user';
  readonly table: string;
  /** The column that names the anchor order of a row; empty when the entity has none (customers, sites). */
  readonly anchorColumn: string;
}

export const SYNCED_ENTITIES: readonly SyncedEntity[] = Object.freeze([
  { type: 'work_order', table: 'work_orders.work_orders', anchorColumn: 'id' },
  { type: 'customer', table: 'customers.customers', anchorColumn: '' },
  { type: 'site', table: 'sites.sites', anchorColumn: '' },
  { type: 'party', table: 'parties.parties', anchorColumn: '' },
  { type: 'scope_item', table: 'work_orders.scope_items', anchorColumn: 'work_order_id' },
  { type: 'procedure_stage', table: 'procedures.procedure_stages', anchorColumn: 'work_order_id' },
  { type: 'timeline_entry', table: 'timeline.timeline_entries', anchorColumn: 'work_order_id' },
  /** Outside the schemas of {@link SYNC_SCOPE_SCHEMAS} on purpose: the other tables of `identity` (credentials, sessions) never reach the phone. */
  { type: 'user', table: 'identity.users', anchorColumn: '' },
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

const LATER = 'assignments of technicians arrive with the role Monter (M4): in v1 every Editor sees every order';
const PROCESS =
  'not an entity of the phone: its code and name travel inside each stage; a change writes the stages (sync.record_procedure_change)';
const CATALOGUE = 'catalogue of the office; reaches the phone with the quick work order (EVM-099)';

/** Tables of the scope schemas that are deliberately NOT synchronised (yet), each with the reason. */
export const SYNC_EXCLUDED_TABLES: Readonly<Record<string, string>> = Object.freeze({
  'work_orders.number_counters': 'technical table of the numbering of orders, never on the phone',
  'work_orders.work_order_assignments': LATER,
  'procedures.procedures': PROCESS,
  'catalog.document_kinds': CATALOGUE,
  'catalog.payment_milestone_templates': 'not on the phone (payments are outside the projection)',
  'catalog.procedure_stage_templates': CATALOGUE,
  'catalog.procedure_templates': CATALOGUE,
  'catalog.service_catalog_item_procedures': CATALOGUE,
  'catalog.service_catalog_items': CATALOGUE,
  'catalog.work_order_template_items': CATALOGUE,
  'catalog.work_order_templates': CATALOGUE,
});
