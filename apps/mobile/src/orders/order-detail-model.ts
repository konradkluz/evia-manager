/**
 * Model of the work order details (EVM-104 AC1-AC5): pure functions that turn one read of the replica and the facts of the queue into
 * what the screen shows. Rules kept here (security K1, K2, K5, K7, K9 of the story):
 * - the source carries only allow-listed keys; the model never contains an e-mail, tax id, PPE, payment, free-text note of the site or
 *   customer, the description of the order or the contact data of a party (only the names of the operator and the manager);
 * - the queue contributes only notes and comments whose `orderingKey` is this work order (never a quick work order or another order);
 * - an entry flagged as redacted has no body in the model, whatever the data says;
 * - the number for the dialer is `+` (first position only) and digits, at most 15; anything else (MMI/USSD codes, pauses) is refused.
 */
import type { QueueRecord } from '@evia/sync-core';

export interface DetailOrder {
  readonly id: string;
  readonly number: string | null;
  readonly title: string;
  readonly status: string;
  readonly customerId: string | null;
  readonly siteId: string | null;
}
export interface DetailCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string;
}
export interface DetailSite {
  readonly id: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpot: string;
  readonly garageLevel: string;
  readonly connectionPowerKw: number | null;
  readonly managerPartyId: string | null;
  readonly operatorPartyId: string | null;
}
/** A party: only the name (no contact person and no phone; security K1). */
export interface DetailParty {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
}
export interface DetailScopeItem {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly quantity: number | null;
}
export interface DetailStageSource {
  readonly id: string;
  readonly procedureId: string;
  readonly procedureName: string;
  readonly name: string;
  readonly position: number;
  readonly status: string;
  readonly waitingOn: string | null;
  readonly waitingPartyId: string | null;
}
export interface DetailEntrySource {
  readonly id: string;
  readonly kind: string;
  readonly noteCategory: string | null;
  readonly body: string | null;
  readonly authorUserId: string | null;
  readonly createdAt: number;
  readonly capturedAt: number | null;
  readonly redactedAt: number | null;
}
export interface DetailUser {
  readonly id: string;
  readonly displayName: string;
}

/** One read of the active generation for one work order: allow-listed keys only, never a whole `fields` document. */
export interface OrderDetailSource {
  readonly order: DetailOrder;
  readonly customer: DetailCustomer | null;
  readonly site: DetailSite | null;
  readonly parties: readonly DetailParty[];
  readonly scopeItems: readonly DetailScopeItem[];
  readonly stages: readonly DetailStageSource[];
  readonly entries: readonly DetailEntrySource[];
  readonly users: readonly DetailUser[];
}

export interface DetailCustomerView {
  readonly name: string;
  /** The phone as typed in the office (shown). */
  readonly phone: string | null;
  /** The sanitised number for the dialer; `null` = no "Zadzwoń" action. */
  readonly dial: string | null;
}
export interface DetailLocationView {
  /** Street and building number. */
  readonly street: string | null;
  /** Postal code and city. */
  readonly city: string | null;
  readonly spot: string | null;
  readonly level: string | null;
  readonly powerKw: string | null;
  readonly operator: string | null;
  readonly manager: string | null;
}
export interface DetailStageView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** The name of whom we wait for (the "Czekamy na…" status only). */
  readonly waitingFor: string | null;
}
export interface DetailProcessView {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly DetailStageView[];
}
export type JournalSource = 'synced' | 'pending' | 'attention';
export interface JournalItem {
  readonly id: string;
  readonly source: JournalSource;
  readonly kind: 'note' | 'comment' | 'event';
  readonly category: string | null;
  /** `null` = the system, or (a queue item) the person who is using the phone. */
  readonly author: string | null;
  readonly at: number;
  /** `null` when redacted or when there is no text. */
  readonly body: string | null;
  readonly redacted: boolean;
}
export interface OrderDetail {
  readonly id: string;
  readonly number: string | null;
  readonly title: string;
  readonly status: string;
  readonly customer: DetailCustomerView | null;
  readonly location: DetailLocationView | null;
  readonly scope: readonly { readonly id: string; readonly name: string; readonly quantity: number | null }[];
  readonly processes: readonly DetailProcessView[];
  readonly journal: readonly JournalItem[];
}

const MAX_DIGITS = 15;
const MIN_DIGITS = 5;

/**
 * The number for `tel:` (security K7): spaces, hyphens, dots and parentheses are formatting and are dropped; the rest must be digits
 * with an optional leading `+`. `*`, `#`, `,`, `;`, `p`, `w` (codes MMI/USSD, pauses), letters, a second `+` or a number of 5 to 15
 * digits outside the range give `null` - the screen then has no call action.
 */
export function dialNumber(phone: string): string | null {
  const compact = phone.replace(/[ \-.()]/g, '');
  const match = /^(\+?)([0-9]+)$/.exec(compact);
  if (match === null) return null;
  const digits = match[2] ?? '';
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return `${match[1] ?? ''}${digits}`;
}

const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function customerView(customer: DetailCustomer | null): DetailCustomerView | null {
  if (customer === null) return null;
  const name = blank(customer.displayName);
  if (name === null) return null;
  const phone = blank(customer.phone);
  return { name, phone, dial: phone === null ? null : dialNumber(phone) };
}

function locationView(site: DetailSite | null, parties: ReadonlyMap<string, string>): DetailLocationView | null {
  if (site === null) return null;
  const join = (...parts: string[]): string | null => blank(parts.filter((part) => part.trim() !== '').join(' '));
  const view: DetailLocationView = {
    street: join(site.street, site.buildingNumber),
    city: join(site.postalCode, site.city),
    spot: blank(site.parkingSpot),
    level: blank(site.garageLevel),
    powerKw: site.connectionPowerKw === null ? null : String(site.connectionPowerKw),
    operator: site.operatorPartyId === null ? null : (blank(parties.get(site.operatorPartyId) ?? '') ?? null),
    manager: site.managerPartyId === null ? null : (blank(parties.get(site.managerPartyId) ?? '') ?? null),
  };
  return Object.values(view).every((value) => value === null) ? null : view;
}

function processesOf(
  stages: readonly DetailStageSource[],
  parties: ReadonlyMap<string, string>,
  customerName: string | null,
): DetailProcessView[] {
  // stable by position: the processes come in the order of their first stage, the stages in the order of their position
  const ordered = stages.map((stage, index) => ({ stage, index })).sort((a, b) => a.stage.position - b.stage.position || a.index - b.index);
  const groups = new Map<string, { name: string; stages: DetailStageView[] }>();
  for (const { stage } of ordered) {
    let group = groups.get(stage.procedureId);
    if (group === undefined) {
      group = { name: stage.procedureName, stages: [] };
      groups.set(stage.procedureId, group);
    }
    let waitingFor: string | null = null;
    if (stage.status === 'waiting') {
      if (stage.waitingOn === 'party' && stage.waitingPartyId !== null) waitingFor = blank(parties.get(stage.waitingPartyId) ?? '');
      else if (stage.waitingOn === 'customer') waitingFor = customerName;
    }
    group.stages.push({ id: stage.id, name: stage.name, status: stage.status, waitingFor });
  }
  return [...groups].map(([id, group]) => ({ id, name: group.name, stages: group.stages }));
}

const KINDS = new Set(['note', 'comment', 'event']);

/**
 * The details of one work order, or `null` when it is not in the active generation of the replica (outside the scope of the phone or
 * deleted in the office; AC5). `records` are the queue entries of the signed-in owner; only notes and comments of this order are used.
 */
export function buildOrderDetail(
  source: OrderDetailSource | null,
  records: readonly QueueRecord[],
  ownerUserId: string,
): OrderDetail | null {
  if (source === null) return null;
  const parties = new Map(source.parties.map((party) => [party.id, party.displayName]));
  const users = new Map(source.users.map((user) => [user.id, user.displayName]));
  const customer = customerView(source.customer);

  const synced: JournalItem[] = source.entries.map((entry) => {
    const redacted = entry.redactedAt !== null;
    return {
      id: entry.id,
      source: 'synced',
      kind: KINDS.has(entry.kind) ? (entry.kind as JournalItem['kind']) : 'event',
      category: entry.noteCategory,
      author: entry.authorUserId === null ? null : (users.get(entry.authorUserId) ?? null),
      at: entry.capturedAt ?? entry.createdAt,
      body: redacted ? null : blank(entry.body ?? ''),
      redacted,
    };
  });
  const known = new Set(synced.map((item) => item.id));
  const owner = users.get(ownerUserId) ?? null;
  const pending: JournalItem[] = records
    .filter(
      (record) =>
        (record.type === 'CreateNote' || record.type === 'CreateComment') &&
        record.orderingKey === source.order.id &&
        !known.has(record.objectId),
    )
    .map((record) => ({
      id: record.objectId,
      source: record.state === 'needs_attention' || record.state === 'blocked' ? ('attention' as const) : ('pending' as const),
      kind: record.type === 'CreateComment' ? ('comment' as const) : ('note' as const),
      category: record.type === 'CreateNote' ? asText(record.payload['noteCategory']) : null,
      author: owner,
      at: record.createdAt,
      body: blank(asText(record.payload['body']) ?? ''),
      redacted: false,
    }));
  const newestFirst = (a: JournalItem, b: JournalItem): number => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return {
    id: source.order.id,
    number: source.order.number,
    title: source.order.title,
    status: source.order.status,
    customer,
    location: locationView(source.site, parties),
    scope: [...source.scopeItems]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ id: item.id, name: item.name, quantity: item.quantity })),
    processes: processesOf(source.stages, parties, customer?.name ?? null),
    journal: [...pending.sort(newestFirst), ...synced.sort(newestFirst)],
  };
}
