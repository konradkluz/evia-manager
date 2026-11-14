// @ts-check
/**
 * The synchronization part of the scenario server (EVM-107 AC6; ADR-0015: the backend runs only in a container, so the emulator talks
 * to this "local API"). It speaks the four operations of the sync contract (EVM-090): client-config, changes, work order snapshot and
 * mutations, for ONE synthetic account with two work orders, and it keeps the counters the scenario asserts: unique mutations,
 * duplicates, everything received.
 *
 * Idempotency follows the contract: the first appearance of a `mutationId` is `applied`; a repeat returns the SAVED result as
 * `duplicate` (it is never a new acceptance) and is counted as a duplicate. The answers are validated against the zod schemas of
 * @evia/contracts in test/sync-stub.test.mjs. Only synthetic data; the bearer token is accepted when it is one of the fixed test words
 * of the sign-in part (no verification of a real token). Nothing is logged and no body is kept except the ids of the mutations.
 */

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MUTATION_TYPES = ['CreateNote', 'CreateComment', 'CreateQuickWorkOrder'];
const SERVER_TIME = () => new Date().toISOString();
/** The marker of the encryption checks (EVM-093; src/device.mjs): the customer 2 carries it so that the list search can be proven (EVM-103 AC6). */
const SENTINEL = ['EVM093', 'SENTINEL'].join('-');

/**
 * The work order 2 (ZL-E2E-2) stands for an order that was deleted in the office before the send (EVM-105 AC6): a note or a comment
 * for it is answered `rejected` / `target_unavailable` (the shape of the contract), the same on every repeat; it is counted as
 * rejected, never as unique. The server is the scenario stand-in of the EVM-107 server (ADR-0015) and is never part of a release build.
 */
export const DELETED_ORDER_ID = '30000000-0000-4000-8000-000000000002';
const REJECTED_TYPES = ['CreateNote', 'CreateComment'];

/**
 * EVM-106: the quick work order and the templates. The scenario sets how the stand-in server answers (`setModes`): the list of templates
 * is `ok` (two synthetic templates), `none` (an empty catalogue) or `channel_not_allowed` (403: the read-only role with the phone token,
 * EVM-127); a quick work order is `ok` (applied once, the number `ZL-E2E-n` comes with the next changes page) or `quota_exceeded`
 * (rejected with that code on every repeat, counted as rejected). The stand-in is never part of a release build.
 * @typedef {{ templates: 'ok' | 'none' | 'channel_not_allowed', quick: 'ok' | 'quota_exceeded' }} SyncModes
 */
export const TEMPLATE_HOUSE_ID = '0194c2a0-0000-7000-8000-00000000e201';
export const TEMPLATE_GARAGE_ID = '0194c2a0-0000-7000-8000-00000000e202';
/** @param {number} position @param {string} code @param {string} name */
const item = (position, code, name) => ({ code, name, position, defaultQuantity: 1, parameterSetCode: null, defaultParameters: {} });
/** The templates of the catalogue (EVM-127 shape; invented names and codes). */
export const TEMPLATE_LIST = Object.freeze({
  items: [
    {
      id: TEMPLATE_HOUSE_ID,
      code: 'dom_sam_montaz',
      name: 'Dom — sam montaż',
      siteTypeHint: 'single_family_house',
      isActive: true,
      items: [item(1, 'wallbox', 'Wallbox 11 kW'), item(2, 'linia', 'Linia zasilająca'), item(3, 'zabezpieczenia', 'Zabezpieczenia')],
      procedures: [{ code: 'montaz', name: 'Montaż', stageCount: 2 }],
      paymentMilestones: [
        { code: 'calosc', name: 'Całość', position: 1, sharePercent: 100, invoiceHint: 'Faktura po montażu', paymentTermDays: 14 },
      ],
    },
    {
      id: TEMPLATE_GARAGE_ID,
      code: 'garaz_pelny',
      name: 'Garaż — pełny proces',
      siteTypeHint: 'multi_family_garage',
      isActive: true,
      items: [item(1, 'wallbox', 'Wallbox 11 kW')],
      procedures: [
        { code: 'osd', name: 'Przyłączenie OSD', stageCount: 4 },
        { code: 'zarzadca', name: 'Zgoda zarządcy', stageCount: 2 },
      ],
      paymentMilestones: [
        { code: 'zaliczka', name: 'Zaliczka', position: 1, sharePercent: 30, invoiceHint: 'Faktura zaliczkowa', paymentTermDays: 7 },
        { code: 'reszta', name: 'Reszta', position: 2, sharePercent: 70, invoiceHint: 'Faktura końcowa', paymentTermDays: 14 },
      ],
    },
  ],
  nextCursor: null,
});

/** The cursor of the snapshot and of the changes phase (opaque to the client; the shape of SyncCursor). */
const CURSOR_AFTER_SNAPSHOT = 'e2e-cursor-after-snapshot-0001';
const CURSOR_CHANGES = 'e2e-cursor-changes-000000002';

export const SYNC_CLIENT_CONFIG = Object.freeze({
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: 30,
  periodicResyncDays: 7,
  scopeRuleVersion: 1,
  minSupportedVersion: { android: '0.1.0', ios: '0.1.0' },
  recommendedVersion: { android: '0.1.0', ios: '0.1.0' },
});

/**
 * @param {number} n
 * @param {string} [prefix]
 */
const id = (n, prefix = '3') => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A snapshot page of two aggregates (customer, site, work order each). */
export function snapshotPage() {
  const at = new Date().toISOString();
  /** @param {number} n */
  const aggregate = (n) => [
    {
      op: 'upsert',
      entity: {
        type: 'customer',
        id: id(n, '1'),
        version: 1,
        kind: 'person',
        displayName: n === 2 ? `Klient Testowy 2 ${SENTINEL}` : `Klient Testowy ${String(n)}`,
        phone: '+48000000000',
      },
    },
    {
      op: 'upsert',
      entity: {
        type: 'site',
        id: id(n, '2'),
        version: 1,
        siteType: 'other',
        street: 'Testowa',
        buildingNumber: String(n),
        apartmentNumber: null,
        postalCode: '00-000',
        city: 'Testowo',
        parkingSpotNumber: null,
        garageLevel: null,
        connectionPowerKw: null,
        managerPartyId: null,
        distributionSystemOperatorPartyId: null,
        notes: null,
      },
    },
    {
      op: 'upsert',
      entity: {
        type: 'work_order',
        id: id(n),
        version: 1,
        number: `ZL-E2E-${String(n)}`,
        title: `Zlecenie testowe ${String(n)}`,
        status: 'in_progress',
        customerId: id(n, '1'),
        siteId: id(n, '2'),
        coordinatorUserId: null,
        description: null,
        plannedDate: null,
        createdAt: at,
        closedAt: null,
      },
    },
  ];
  /**
   * The details of the work order 1 (EVM-104): one scope item, one process with two stages and two entries of the journal - all
   * invented text, so a screenshot of the scenario can be attached as evidence without review.
   */
  const details = () => {
    const workOrderId = id(1);
    const procedureId = id(1, '6');
    /** @param {string} type @param {number} n @param {Record<string, unknown>} fields */
    const entity = (type, n, fields) => ({ op: 'upsert', entity: { type, id: id(n, '5'), version: 1, workOrderId, ...fields } });
    const stage = {
      procedureId,
      procedureCode: 'osd',
      procedureName: 'Proces testowy OSD',
      dueDate: null,
      responsibleUserId: null,
      waitingOn: null,
      waitingPartyId: null,
      waitingSince: null,
      blockedReason: null,
      startedAt: null,
      completedOn: null,
    };
    return [
      entity('scope_item', 1, {
        position: 1,
        code: 'WALLBOX',
        name: 'Wallbox testowy 11 kW',
        parameterSetCode: null,
        parameters: {},
        quantity: 2,
        notes: null,
      }),
      entity('procedure_stage', 1, { ...stage, code: 'wniosek', name: 'Wniosek testowy', position: 1, status: 'done' }),
      entity('procedure_stage', 2, { ...stage, code: 'umowa', name: 'Umowa testowa', position: 2, status: 'todo' }),
      entity('timeline_entry', 1, {
        kind: 'note',
        noteCategory: 'phone_call',
        body: 'Wpis testowy: rozmowa fikcyjna.',
        procedureStageId: null,
        authorUserId: null,
        createdAt: at,
        origin: 'web',
        capturedAt: null,
        supersedesEntryId: null,
        supersededByEntryId: null,
        redactedAt: null,
      }),
      entity('timeline_entry', 2, {
        kind: 'event',
        noteCategory: null,
        body: 'Zdarzenie testowe: zmiana etapu.',
        procedureStageId: null,
        authorUserId: null,
        createdAt: at,
        origin: 'system',
        capturedAt: null,
        supersedesEntryId: null,
        supersededByEntryId: null,
        redactedAt: null,
      }),
    ];
  };
  return {
    result: 'changes',
    phase: 'snapshot',
    changes: [...aggregate(1), ...aggregate(2), ...details()],
    cursor: CURSOR_AFTER_SNAPSHOT,
    hasMore: false,
    serverTime: SERVER_TIME(),
  };
}

/**
 * @param {string | null} cursor
 * @param {{ changes: unknown[], cursor: string }} [extra] what the server created since the last page (EVM-106: the numbered quick orders)
 */
export function changesAnswer(cursor, extra) {
  if (cursor === null) return snapshotPage();
  return {
    result: 'changes',
    phase: 'changes',
    changes: extra?.changes ?? [],
    cursor: extra?.cursor ?? CURSOR_CHANGES,
    hasMore: false,
    serverTime: SERVER_TIME(),
  };
}

/**
 * The aggregate the server creates from an accepted quick work order (EVM-106 AC4): the new customer and place of the payload (the
 * existing ones are only referred to) and the order with its number. Fields are copied from the payload the app sent.
 * @param {Record<string, unknown>} payload
 * @param {string} number
 */
export function createdAggregate(payload, number) {
  const at = new Date().toISOString();
  /** @param {Record<string, unknown>} from @param {string} key */
  const text = (from, key) => (typeof from[key] === 'string' ? from[key] : null);
  const customer = /** @type {Record<string, unknown> | null} */ (
    typeof payload['newCustomer'] === 'object' ? payload['newCustomer'] : null
  );
  const site = /** @type {Record<string, unknown> | null} */ (typeof payload['newSite'] === 'object' ? payload['newSite'] : null);
  const customerId = customer === null ? text(payload, 'customerId') : text(customer, 'id');
  const siteId = site === null ? text(payload, 'siteId') : text(site, 'id');
  /** @type {unknown[]} */
  const out = [];
  if (customer !== null) {
    out.push({
      op: 'upsert',
      entity: {
        type: 'customer',
        id: customerId,
        version: 1,
        kind: text(customer, 'kind'),
        displayName: text(customer, 'displayName'),
        phone: text(customer, 'phone'),
      },
    });
  }
  if (site !== null) {
    out.push({
      op: 'upsert',
      entity: {
        type: 'site',
        id: siteId,
        version: 1,
        siteType: text(site, 'siteType'),
        street: text(site, 'street'),
        buildingNumber: text(site, 'buildingNumber'),
        apartmentNumber: text(site, 'apartmentNumber'),
        postalCode: text(site, 'postalCode'),
        city: text(site, 'city'),
        parkingSpotNumber: text(site, 'parkingSpotNumber'),
        garageLevel: null,
        connectionPowerKw: null,
        managerPartyId: null,
        distributionSystemOperatorPartyId: null,
        notes: null,
      },
    });
  }
  out.push({
    op: 'upsert',
    entity: {
      type: 'work_order',
      id: text(payload, 'workOrderId'),
      version: 1,
      number,
      title: text(payload, 'title'),
      status: 'new',
      customerId,
      siteId,
      coordinatorUserId: null,
      description: null,
      plannedDate: null,
      createdAt: at,
      closedAt: null,
    },
  });
  return out;
}

/**
 * @typedef {{ unique: number, duplicates: number, rejected: number, received: number, requests: number, lastPendingItems: number | null }} SyncReport
 * @typedef {{ status: number, type: string, body: unknown }} Answer
 */

export function createSyncStub() {
  /** @type {Map<string, { outcome: string }>} */
  let saved = new Map();
  /** @type {Map<string, string>} mutation id -> the code of the rejection (stable on every repeat) */
  let rejectedIds = new Map();
  /** @type {SyncModes} */
  let modes = { templates: 'ok', quick: 'ok' };
  /** What the server created and has not yet sent in a changes page; the work orders it created. */
  /** @type {unknown[]} */
  let created = [];
  /** @type {Set<string>} */
  let createdOrders = new Set();
  let cursorSerial = 0;
  let duplicates = 0;
  let received = 0;
  let requests = 0;
  /** @type {number | null} */
  let lastPendingItems = null;

  /**
   * @param {number} status
   * @param {string} code
   * @returns {Answer}
   */
  const problem = (status, code) => ({
    status,
    type: 'application/problem+json',
    body: { type: 'about:blank', title: code, status, code, traceId: '0'.repeat(32) },
  });

  return {
    /** @returns {SyncReport} */
    report: () => ({ unique: saved.size, duplicates, rejected: rejectedIds.size, received, requests, lastPendingItems }),
    /** @param {Partial<SyncModes>} next */
    setModes: (next) => {
      modes = { ...modes, ...next };
    },
    reset: () => {
      saved = new Map();
      rejectedIds = new Map();
      created = [];
      createdOrders = new Set();
      cursorSerial = 0;
      duplicates = 0;
      received = 0;
      requests = 0;
      lastPendingItems = null;
    },
    /**
     * @param {string} method
     * @param {string} path path without the query
     * @param {URLSearchParams} query
     * @param {unknown} body parsed JSON of a POST
     * @param {boolean} authorized whether the request carries a bearer token
     * @returns {Answer | null} `null` = not a sync path
     */
    handle(method, path, query, body, authorized) {
      const isConfig = method === 'GET' && path === '/api/v1/meta/client-config';
      const isChanges = method === 'GET' && path === '/api/v1/sync/changes';
      const isOrder = method === 'GET' && /^\/api\/v1\/sync\/work-orders\/[0-9a-f-]{36}$/.test(path);
      const isMutations = method === 'POST' && path === '/api/v1/sync/mutations';
      const isTemplates = method === 'GET' && path === '/api/v1/catalog/work-order-templates';
      if (!isConfig && !isChanges && !isOrder && !isMutations && !isTemplates) return null;
      requests += 1;
      if (!authorized) return problem(401, 'unauthenticated');
      if (isTemplates) {
        if (modes.templates === 'channel_not_allowed') return problem(403, 'channel_not_allowed');
        return {
          status: 200,
          type: 'application/json',
          body: modes.templates === 'none' ? { items: [], nextCursor: null } : TEMPLATE_LIST,
        };
      }
      if (isConfig) return { status: 200, type: 'application/json', body: SYNC_CLIENT_CONFIG };
      if (isChanges) {
        const pending = Number(query.get('pendingItems'));
        if (Number.isInteger(pending) && pending >= 0) lastPendingItems = pending;
        const given = query.get('cursor');
        let extra;
        if (given !== null && created.length > 0) {
          cursorSerial += 1;
          extra = { changes: created, cursor: `e2e-cursor-changes-${String(cursorSerial).padStart(9, '0')}` };
          created = [];
        }
        return { status: 200, type: 'application/json', body: changesAnswer(given, extra) };
      }
      if (isOrder) return problem(404, 'not_found');
      const fields = /** @type {Record<string, unknown>} */ (typeof body === 'object' && body !== null ? body : {});
      const list = fields['mutations'];
      const pendingItems = fields['pendingItems'];
      if (!Array.isArray(list) || list.length === 0 || list.length > 50) return problem(400, 'validation_failed');
      if (typeof pendingItems !== 'number' || !Number.isInteger(pendingItems) || pendingItems < 0) return problem(400, 'validation_failed');
      /** @type {{ mutationId: string, rejection: string | null, quick: Record<string, unknown> | null }[]} */
      const ids = [];
      for (const item of list) {
        // a parsed JSON body is untyped; every field is checked below
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const m = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (typeof item === 'object' && item !== null ? item : {}));
        const mutationId = m['mutationId'];
        const type = m['type'];
        if (typeof mutationId !== 'string' || !UUIDV7.test(mutationId)) return problem(400, 'validation_failed');
        if (typeof type !== 'string' || !MUTATION_TYPES.includes(type)) return problem(400, 'validation_failed');
        const payload = m['payload'];
        const target =
          typeof payload === 'object' && payload !== null ? /** @type {Record<string, unknown>} */ (payload)['workOrderId'] : undefined;
        const isQuick = type === 'CreateQuickWorkOrder';
        /** @type {string | null} */
        let rejection = null;
        if (target === DELETED_ORDER_ID && REJECTED_TYPES.includes(type)) rejection = 'target_unavailable';
        else if (isQuick && modes.quick === 'quota_exceeded') rejection = 'quota_exceeded';
        ids.push({ mutationId, rejection, quick: isQuick ? /** @type {Record<string, unknown>} */ (payload) : null });
      }
      lastPendingItems = pendingItems;
      const results = ids.map(({ mutationId, rejection, quick }) => {
        received += 1;
        const earlier = rejectedIds.get(mutationId);
        if (rejection !== null || earlier !== undefined) {
          const code = earlier ?? rejection ?? 'target_unavailable';
          rejectedIds.set(mutationId, code);
          return { mutationId, outcome: 'rejected', code };
        }
        if (saved.has(mutationId)) {
          duplicates += 1;
          return { mutationId, outcome: 'duplicate' };
        }
        saved.set(mutationId, { outcome: 'applied' });
        // a quick work order is created once; its number comes with the next changes page (EVM-106 AC4)
        const workOrderId = quick?.['workOrderId'];
        if (quick !== null && typeof workOrderId === 'string' && !createdOrders.has(workOrderId)) {
          createdOrders.add(workOrderId);
          created.push(...createdAggregate(quick, `ZL-E2E-${String(2 + createdOrders.size)}`));
        }
        return { mutationId, outcome: 'applied' };
      });
      return { status: 200, type: 'application/json', body: { serverTime: SERVER_TIME(), results } };
    },
  };
}
