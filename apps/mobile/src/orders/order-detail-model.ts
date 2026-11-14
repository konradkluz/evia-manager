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
import type { QuickOrderSource } from './quick-order-model';
import type { TemplateSet } from './templates';

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
  /** The id of the entry this one corrects (this entry is a correction). */
  readonly supersedesEntryId: string | null;
  /** The id of the entry that corrects this one (this entry is superseded). */
  readonly supersededByEntryId: string | null;
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
  /** Replaced by a correction: the old text is never shown (the screen says "Zastąpiony poprawką"). */
  readonly superseded: boolean;
  /** Corrects an earlier entry. */
  readonly correction: boolean;
  /** A queue item that waits for the work order it belongs to to be created ("Wyślemy po utworzeniu zlecenia"; EVM-106 AC2). */
  readonly awaitsOrder?: boolean;
}
export interface OrderDetail {
  readonly id: string;
  readonly number: string | null;
  readonly title: string;
  readonly status: string;
  /** The order is a quick one still in the queue: no number yet ("Oczekuje na numer"; EVM-106 AC2). */
  readonly awaitingNumber?: boolean;
  /** The name of the template of an order that is not on the server yet (from the templates of the phone). */
  readonly templateName?: string | null;
  /** The note typed with a quick order (shown only for an order that is not on the server yet). */
  readonly note?: string | null;
  /** The mutation of the quick order in the queue: entries added to the order wait behind it (EVM-106). */
  readonly pendingMutationId?: string;
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
  const sign = compact.startsWith('+') ? '+' : '';
  const digits = compact.slice(sign.length);
  return /^[0-9]+$/.test(digits) && digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS ? `${sign}${digits}` : null;
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
    const superseded = entry.supersededByEntryId !== null;
    return {
      id: entry.id,
      source: 'synced',
      kind: KINDS.has(entry.kind) ? (entry.kind as JournalItem['kind']) : 'event',
      category: entry.noteCategory,
      author: entry.authorUserId === null ? null : (users.get(entry.authorUserId) ?? null),
      at: entry.capturedAt ?? entry.createdAt,
      body: redacted || superseded ? null : blank(entry.body ?? ''),
      redacted,
      superseded,
      correction: entry.supersedesEntryId !== null,
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
      superseded: false,
      correction: false,
    }));
  const newestFirst = (a: JournalItem, b: JournalItem): number => b.at - a.at || a.id.localeCompare(b.id);

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

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The details of a quick work order that is only in the queue (EVM-106 AC2; security K3, K4): built from the `CreateQuickWorkOrder` of
 * the owner (title, new customer and place or the chosen ones of the replica, template by name from the templates of the phone) and the
 * entries waiting behind it ("Wyślemy po utworzeniu zlecenia"). No number is invented. `null` when there is no such command or its
 * payload is damaged (the screen then says the order is unavailable; nothing is logged).
 */
export function buildPendingOrderDetail(
  workOrderId: string,
  records: readonly QueueRecord[],
  source: QuickOrderSource,
  templates: TemplateSet | null,
): OrderDetail | null {
  const command = records.find((record) => record.type === 'CreateQuickWorkOrder' && record.objectId === workOrderId);
  if (command === undefined) return null;
  const payload = command.payload;
  const title = blank(str(payload['title']));
  if (title === null) return null;
  const fresh = obj(payload['newCustomer']);
  const knownCustomer = source.customers.find((customer) => customer.id === str(payload['customerId']));
  const customerSource =
    typeof payload['newCustomer'] === 'object' ? { displayName: str(fresh['displayName']), phone: str(fresh['phone']) } : knownCustomer;
  const customer = customerView(
    customerSource === undefined ? null : { id: '', displayName: customerSource.displayName, phone: customerSource.phone },
  );
  const place = obj(payload['newSite']);
  const knownSite = source.sites.find((site) => site.id === str(payload['siteId']));
  const siteSource = typeof payload['newSite'] === 'object' ? place : knownSite === undefined ? null : { ...knownSite };
  const location =
    siteSource === null
      ? null
      : locationView(
          {
            id: '',
            street: str(siteSource['street']),
            buildingNumber: str(siteSource['buildingNumber']),
            postalCode: str(siteSource['postalCode']),
            city: str(siteSource['city']),
            parkingSpot: str(siteSource['parkingSpotNumber']),
            garageLevel: '',
            connectionPowerKw: null,
            managerPartyId: null,
            operatorPartyId: null,
          },
          new Map(),
        );
  const templateName = templates?.items.find((template) => template.id === str(payload['templateId']))?.name ?? null;
  const journal: JournalItem[] = records
    .filter((record) => (record.type === 'CreateNote' || record.type === 'CreateComment') && record.orderingKey === workOrderId)
    .map((record) => ({
      id: record.objectId,
      source: record.state === 'needs_attention' || record.state === 'blocked' ? ('attention' as const) : ('pending' as const),
      kind: record.type === 'CreateComment' ? ('comment' as const) : ('note' as const),
      category: record.type === 'CreateNote' ? asText(record.payload['noteCategory']) : null,
      author: null,
      at: record.createdAt,
      body: blank(asText(record.payload['body']) ?? ''),
      redacted: false,
      superseded: false,
      correction: false,
      awaitsOrder: true,
    }))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return {
    id: workOrderId,
    number: null,
    title,
    status: 'new',
    awaitingNumber: true,
    pendingMutationId: command.mutationId,
    templateName,
    note: blank(str(payload['note'])),
    customer,
    location,
    scope: [],
    processes: [],
    journal,
  };
}
