/**
 * Model of "Moje zlecenia" (EVM-103 AC1–AC3, AC5, AC6): pure functions that turn one read of the replica and the queue into rows and
 * filter them in memory. Rules kept here (architect and security of the story):
 * - the search key (`keys`) lives only on the rows in process memory; there is no persistent index and no copy outside the SQLCipher
 *   replica; the redacted model of the hidden-data mode has empty keys and empty personal fields;
 * - the query is only ever compared with `includes` on a normalised key (never SQL, RegExp or LIKE; CWE-89, CWE-1333);
 * - the order is by creation date, newest first (the projection has no change date; decision of 2026-11-12); a work order that waits
 *   for its number (`awaitingNumber`) stays on top, also in the results.
 */
import type { QueueRecord } from '@evia/sync-core';
import { normalizeSearch } from './normalize';

export interface SourceOrder {
  readonly id: string;
  readonly number: string | null;
  readonly status: string;
  readonly createdAt: number;
  readonly customerId: string | null;
  readonly siteId: string | null;
}
export interface SourceCustomer {
  readonly id: string;
  readonly displayName: string;
}
export interface SourceSite {
  readonly id: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly city: string;
  readonly parkingSpot: string;
}
export interface SourceStage {
  readonly workOrderId: string;
  readonly name: string;
  readonly position: number;
  readonly status: string;
}

/** One read of the active generation of the replica: only the allow-listed keys, never a whole `fields` document (security K1). */
export interface OrderListSource {
  readonly orders: readonly SourceOrder[];
  readonly customers: readonly SourceCustomer[];
  readonly sites: readonly SourceSite[];
  readonly stages: readonly SourceStage[];
}

export const EMPTY_SOURCE: OrderListSource = { orders: [], customers: [], sites: [], stages: [] };

/** What the list needs to know about an element of the queue; the contents only with `withData` (security K2). */
export interface QueueFact {
  readonly mutationId: string;
  readonly type: QueueRecord['type'];
  /** The work order the element belongs to (for a quick work order: the one it creates). */
  readonly orderingKey: string;
  readonly state: QueueRecord['state'];
  readonly createdAt: number;
  readonly customerId?: string;
  readonly siteId?: string;
  readonly customerName?: string;
  readonly site?: { readonly street: string; readonly buildingNumber: string; readonly city: string; readonly parkingSpot: string };
}

export interface SearchKeys {
  readonly number: string;
  readonly address: string;
  readonly customer: string;
}

export interface OrderRow {
  readonly id: string;
  /** `null` = "Oczekuje na numer". */
  readonly number: string | null;
  readonly status: string;
  readonly createdAt: number;
  readonly awaitingNumber: boolean;
  /** The work order has elements in the queue. */
  readonly unsent: boolean;
  readonly customer: string;
  /** Street and building number. */
  readonly street: string;
  readonly city: string;
  readonly spot: string;
  readonly stage: string;
  readonly keys: SearchKeys;
}

export type OrderChip = 'all' | 'unsent';

const NO_KEYS: SearchKeys = { number: '', address: '', customer: '' };
const FINISHED_STAGE = new Set(['done', 'not_applicable']);

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The facts of the queue for the list; in the hidden-data mode only ids, the type and the state are mapped (security K2). */
export function queueFact(record: QueueRecord, withData: boolean): QueueFact {
  const base = {
    mutationId: record.mutationId,
    type: record.type,
    orderingKey: record.orderingKey,
    state: record.state,
    createdAt: record.createdAt,
  };
  if (!withData || record.type !== 'CreateQuickWorkOrder') return base;
  const payload = record.payload;
  const customer = asRecord(payload['newCustomer']);
  const site = asRecord(payload['newSite']);
  const customerName = asText(customer['displayName']);
  const hasSite = Object.keys(site).length > 0;
  return {
    ...base,
    ...(typeof payload['customerId'] === 'string' ? { customerId: payload['customerId'] } : {}),
    ...(typeof payload['siteId'] === 'string' ? { siteId: payload['siteId'] } : {}),
    ...(customerName === '' ? {} : { customerName }),
    ...(hasSite
      ? {
          site: {
            street: asText(site['street']),
            buildingNumber: asText(site['buildingNumber']),
            city: asText(site['city']),
            parkingSpot: asText(site['parkingSpotNumber']),
          },
        }
      : {}),
  };
}

interface RowFacts {
  readonly number: string | null;
  readonly status: string;
  readonly createdAt: number;
  readonly unsent: boolean;
  readonly customer: string;
  readonly street: string;
  readonly city: string;
  readonly spot: string;
  readonly stage: string;
}

function row(id: string, facts: RowFacts): OrderRow {
  const address = [facts.street, facts.city, facts.spot].filter((part) => part !== '').join(' ');
  const keys: SearchKeys = {
    number: normalizeSearch(facts.number ?? ''),
    address: normalizeSearch(address),
    customer: normalizeSearch(facts.customer),
  };
  return { id, awaitingNumber: facts.number === null, ...facts, keys };
}

const addressOf = (site: { street: string; buildingNumber: string } | undefined): string =>
  site === undefined ? '' : `${site.street} ${site.buildingNumber}`.trim();

const baseOrder = (a: OrderRow, b: OrderRow): number => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Rows from one read of the replica and the facts of the queue: the work orders of the replica, plus those only the queue knows
 * (quick work orders that wait for their number). A work order of the replica wins over a queue fact with the same id.
 */
export function buildOrderList(source: OrderListSource, facts: readonly QueueFact[]): OrderRow[] {
  const customers = new Map(source.customers.map((c) => [c.id, c.displayName]));
  const sites = new Map(source.sites.map((s) => [s.id, s]));
  const stageOf = new Map<string, SourceStage>();
  for (const stage of source.stages) {
    if (FINISHED_STAGE.has(stage.status)) continue;
    const current = stageOf.get(stage.workOrderId);
    if (current === undefined || stage.position < current.position) stageOf.set(stage.workOrderId, stage);
  }
  const unsent = new Set(facts.map((fact) => fact.orderingKey));
  const rows: OrderRow[] = [];
  const known = new Set<string>();
  for (const order of source.orders) {
    known.add(order.id);
    const site = order.siteId === null ? undefined : sites.get(order.siteId);
    rows.push(
      row(order.id, {
        number: order.number,
        status: order.status,
        createdAt: order.createdAt,
        unsent: unsent.has(order.id),
        customer: order.customerId === null ? '' : (customers.get(order.customerId) ?? ''),
        street: addressOf(site),
        city: site?.city ?? '',
        spot: site?.parkingSpot ?? '',
        stage: stageOf.get(order.id)?.name ?? '',
      }),
    );
  }
  for (const fact of facts) {
    if (fact.type !== 'CreateQuickWorkOrder' || known.has(fact.orderingKey)) continue;
    known.add(fact.orderingKey);
    const site = fact.site ?? (fact.siteId === undefined ? undefined : sites.get(fact.siteId));
    rows.push(
      row(fact.orderingKey, {
        number: null,
        status: 'new',
        createdAt: fact.createdAt,
        unsent: true,
        customer: fact.customerName ?? (fact.customerId === undefined ? '' : (customers.get(fact.customerId) ?? '')),
        street: addressOf(site),
        city: site?.city ?? '',
        spot: site?.parkingSpot ?? '',
        stage: '',
      }),
    );
  }
  return rows.sort(baseOrder);
}

/** The model of the hidden-data mode (AC5): no name, address, place or key; ids, numbers, statuses and the unsent flag stay. */
export function redactRows(rows: readonly OrderRow[]): OrderRow[] {
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    createdAt: r.createdAt,
    awaitingNumber: r.awaitingNumber,
    unsent: r.unsent,
    customer: '',
    street: '',
    city: '',
    spot: '',
    stage: '',
    keys: NO_KEYS,
  }));
}

/** "Niewysłane (n)": every work order in scope with elements in the queue, whatever the query. */
export const unsentCount = (rows: readonly OrderRow[]): number => rows.reduce((n, r) => n + (r.unsent ? 1 : 0), 0);

/**
 * The rows to show: the chip and the query together. With a query: only matches, by relevance (number, then address, then customer),
 * then the base order; "Oczekuje na numer" first in every case. An empty (or blank) query is the full list.
 */
export function filterOrders(rows: readonly OrderRow[], query: string, chip: OrderChip): OrderRow[] {
  const key = normalizeSearch(query).trim();
  const out: { row: OrderRow; score: number }[] = [];
  for (const candidate of rows) {
    if (chip === 'unsent' && !candidate.unsent) continue;
    let score = 0;
    if (key !== '') {
      if (candidate.keys.number.includes(key)) score = 0;
      else if (candidate.keys.address.includes(key)) score = 1;
      else if (candidate.keys.customer.includes(key)) score = 2;
      else continue;
    }
    out.push({ row: candidate, score });
  }
  out.sort((a, b) => Number(b.row.awaitingNumber) - Number(a.row.awaitingNumber) || a.score - b.score || baseOrder(a.row, b.row));
  return out.map((entry) => entry.row);
}
