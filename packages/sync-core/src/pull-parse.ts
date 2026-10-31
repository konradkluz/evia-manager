import {
  CURSOR_PATTERN,
  DEFAULT_CLIENT_CONFIG,
  ENTITY_TYPES,
  RESYNC_REASONS,
  type ChangesPage,
  type ClientConfig,
  type EntityType,
  type FieldValue,
  type ParsedChange,
  type ReplicaEntity,
  type ResyncRequired,
  type ResyncReason,
  type WorkOrderSnapshot,
} from './pull-types.ts';
import { UUID_PATTERN } from './types.ts';
import { parseServerTime } from './util.ts';

/**
 * Hand-written reader of server data (SR-MOB-10, SR-SYNC-04, CWE-20/CWE-1321), TOLERANT like the contract's `parseSyncChange`
 * (`looseObject`, ADR-0004: adding a field is not a breaking change): a missing or malformed field makes the change `invalid`, an extra
 * field is dropped (never copied). `strict: true` (server-side contract tests only) makes an extra field `invalid` too. Fields are
 * copied one by one from an explicit list; server data is never spread. An unknown value of an extensible vocabulary is stored as `'unknown'`.
 */
type Spec =
  | { readonly k: 'uuid'; readonly nullable?: boolean; readonly ref?: EntityType }
  | { readonly k: 'str'; readonly max: number; readonly nullable?: boolean }
  | { readonly k: 'enum'; readonly values: readonly string[]; readonly nullable?: boolean }
  | { readonly k: 'int'; readonly min: number; readonly max: number; readonly nullable?: boolean }
  | { readonly k: 'num'; readonly min: number; readonly max: number; readonly nullable?: boolean }
  | { readonly k: 'ts'; readonly nullable?: boolean }
  | { readonly k: 'date'; readonly nullable?: boolean }
  | { readonly k: 'params' };

const uuid = (nullable = false, ref?: EntityType): Spec => ({ k: 'uuid', nullable, ...(ref === undefined ? {} : { ref }) });
const str = (max: number, nullable = false): Spec => ({ k: 'str', max, nullable });
const en = (values: readonly string[], nullable = false): Spec => ({ k: 'enum', values, nullable });
const int = (min: number, max: number, nullable = false): Spec => ({ k: 'int', min, max, nullable });
const ts = (nullable = false): Spec => ({ k: 'ts', nullable });
const date = (nullable = false): Spec => ({ k: 'date', nullable });
const MAX_INT = Number.MAX_SAFE_INTEGER;

export const PROJECTIONS: Readonly<Record<EntityType, Readonly<Record<string, Spec>>>> = {
  work_order: {
    number: str(32),
    title: str(200),
    status: en(['new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled']),
    customerId: uuid(true, 'customer'),
    siteId: uuid(true, 'site'),
    coordinatorUserId: uuid(true, 'user'),
    description: str(2000, true),
    plannedDate: date(true),
    createdAt: ts(),
    closedAt: ts(true),
  },
  customer: { kind: en(['person', 'company']), displayName: str(401), phone: str(32) },
  site: {
    siteType: en(['single_family_house', 'multi_family_garage', 'commercial', 'other']),
    street: str(200),
    buildingNumber: str(20),
    apartmentNumber: str(20, true),
    postalCode: str(6),
    city: str(100),
    parkingSpotNumber: str(20, true),
    garageLevel: str(20, true),
    connectionPowerKw: { k: 'num', min: 0, max: 1000, nullable: true },
    managerPartyId: uuid(true, 'party'),
    distributionSystemOperatorPartyId: uuid(true, 'party'),
    notes: str(2000, true),
  },
  party: {
    kind: en([
      'building_administration',
      'property_manager',
      'housing_community',
      'designer',
      'fire_safety_expert',
      'technical_expert',
      'distribution_system_operator',
      'subcontractor',
      'supplier',
      'other',
    ]),
    displayName: str(200),
    contactPersonName: str(200, true),
    phone: str(32, true),
  },
  scope_item: {
    workOrderId: uuid(),
    position: int(1, 50),
    code: str(64),
    name: str(200),
    parameterSetCode: str(64, true),
    parameters: { k: 'params' },
    quantity: int(1, 100),
    notes: str(1000, true),
  },
  procedure_stage: {
    workOrderId: uuid(),
    procedureId: uuid(),
    procedureCode: str(64),
    procedureName: str(200),
    code: str(64),
    name: str(200),
    position: int(1, 30),
    status: en(['todo', 'in_progress', 'waiting', 'blocked', 'done', 'not_applicable']),
    dueDate: date(true),
    responsibleUserId: uuid(true, 'user'),
    waitingOn: en(['customer', 'party'], true),
    waitingPartyId: uuid(true, 'party'),
    waitingSince: date(true),
    blockedReason: str(1000, true),
    startedAt: ts(true),
    completedOn: date(true),
  },
  timeline_entry: {
    workOrderId: uuid(),
    kind: en(['note', 'comment', 'event']),
    noteCategory: en(['phone_call', 'meeting', 'arrangement', 'site_visit', 'other'], true),
    body: str(20_000, true),
    procedureStageId: uuid(true, 'procedure_stage'),
    authorUserId: uuid(true, 'user'),
    createdAt: ts(),
    origin: en(['web', 'mobile', 'system']),
    capturedAt: ts(true),
    supersedesEntryId: uuid(true),
    supersededByEntryId: uuid(true),
    redactedAt: ts(true),
  },
  media_asset: {
    workOrderId: uuid(),
    mediaType: en(['photo', 'video']),
    category: str(64, true),
    description: str(1000, true),
    procedureStageId: uuid(true, 'procedure_stage'),
    capturedAt: ts(true),
    fileState: en(['pending', 'uploading', 'processing', 'ready', 'failed']),
    fileStateReasonCode: en(['checksum_mismatch', 'processing_error'], true),
    sizeBytes: int(0, MAX_INT, true),
    durationSeconds: { k: 'num', min: 0, max: MAX_INT, nullable: true },
    widthPx: int(0, MAX_INT, true),
    heightPx: int(0, MAX_INT, true),
  },
  user: { displayName: str(200) },
};

/** Types anchored to a work order (`workOrderId`): children of the aggregate. */
export const ANCHORED_TYPES: readonly EntityType[] = ENTITY_TYPES.filter((t) => Object.hasOwn(PROJECTIONS[t], 'workOrderId'));

const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const MAX_PARAMS = 30;
const MAX_PARAM_KEY = 64;
const MAX_PARAM_TEXT = 200;
const HEAD_KEYS: readonly string[] = ['type', 'id', 'version'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NOPE = Symbol('nope');

function readField(spec: Spec, raw: unknown): FieldValue | typeof NOPE {
  if (raw === null) return spec.k !== 'params' && spec.nullable === true ? null : NOPE;
  switch (spec.k) {
    case 'uuid':
      return typeof raw === 'string' && UUID_PATTERN.test(raw) ? raw : NOPE;
    case 'str':
      return typeof raw === 'string' && raw.length <= spec.max ? raw : NOPE;
    case 'enum':
      if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) return NOPE;
      return spec.values.includes(raw) ? raw : 'unknown';
    case 'int':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= spec.min && raw <= spec.max ? raw : NOPE;
    case 'num':
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= spec.min && raw <= spec.max ? raw : NOPE;
    case 'ts':
      return typeof raw === 'string' && raw.length <= 40 && TS.test(raw) ? raw : NOPE;
    case 'date':
      return typeof raw === 'string' && DATE.test(raw) ? raw : NOPE;
    case 'params': {
      if (!isObject(raw)) return NOPE;
      const keys = Object.keys(raw);
      if (keys.length > MAX_PARAMS) return NOPE;
      const out: Record<string, string | number | boolean> = {};
      for (const key of keys) {
        const value = raw[key];
        if (FORBIDDEN_KEYS.includes(key) || key.length < 1 || key.length > MAX_PARAM_KEY) return NOPE;
        if (
          typeof value === 'string'
            ? value.length > MAX_PARAM_TEXT
            : typeof value === 'number'
              ? !Number.isFinite(value)
              : typeof value !== 'boolean'
        )
          return NOPE;
        out[key] = value as string | number | boolean;
      }
      return out;
    }
  }
}

const isEntityType = (type: unknown): type is EntityType => typeof type === 'string' && Object.hasOwn(PROJECTIONS, type);

/** Reads one entity of a known type; `null` when it does not match its projection (extra, missing or malformed fields). */
function readEntity(type: EntityType, raw: Record<string, unknown>, strict: boolean): ReplicaEntity | null {
  const keys = Object.keys(raw);
  if (keys.some((k) => FORBIDDEN_KEYS.includes(k))) return null;
  const projection = PROJECTIONS[type];
  if (strict && keys.some((k) => !HEAD_KEYS.includes(k) && !Object.hasOwn(projection, k))) return null;
  const { id, version } = raw;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_INT) return null;
  const fields: Record<string, FieldValue> = {};
  for (const name of Object.keys(projection)) {
    const spec = projection[name];
    if (spec === undefined || !Object.hasOwn(raw, name)) return null;
    const value = readField(spec, raw[name]);
    if (value === NOPE) return null;
    fields[name] = value;
  }
  return { type, id, version, fields };
}

export interface ParseOptions {
  /** `false` (default): a field outside the projection is dropped (forward compatible reader). `true`: it makes the change `invalid`. */
  readonly strict?: boolean;
}

/** Parses ONE element of a page (the page is never rejected because of one element). Failures carry only a reason and a vocabulary type. */
export function parseChange(raw: unknown, options: ParseOptions = {}): ParsedChange {
  const strict = options.strict ?? false;
  const malformed: ParsedChange = { kind: 'invalid', reason: 'malformed', type: 'unknown' };
  if (!isObject(raw)) return malformed;
  const op = raw['op'];
  if (op === 'delete') {
    if (strict && Object.keys(raw).some((k) => !['op', 'type', 'id', 'version'].includes(k))) return malformed;
    const { type, id, version } = raw;
    if (typeof type !== 'string' || type.length > 64 || typeof id !== 'string' || !UUID_PATTERN.test(id)) return malformed;
    if (version !== undefined && !(typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= MAX_INT))
      return malformed;
    if (!isEntityType(type)) return { kind: 'unknown' };
    return { kind: 'delete', type, id, ...(version === undefined ? {} : { version }) };
  }
  if (op !== 'upsert') return malformed;
  if (strict && Object.keys(raw).some((k) => k !== 'op' && k !== 'entity')) return malformed;
  const entity = raw['entity'];
  if (!isObject(entity)) return malformed;
  const type = entity['type'];
  if (typeof type !== 'string' || type.length > 64) return malformed;
  if (!isEntityType(type)) return { kind: 'unknown' };
  const parsed = readEntity(type, entity, strict);
  return parsed === null ? { kind: 'invalid', reason: 'projection_mismatch', type } : { kind: 'upsert', entity: parsed };
}

/** Parses one entity of a work-order snapshot (an upsert without the envelope); anything else is `invalid`. */
export function parseSnapshotEntity(raw: unknown, options: ParseOptions = {}): Exclude<ParsedChange, { kind: 'delete' }> {
  return parseChange({ op: 'upsert', entity: raw }, options) as Exclude<ParsedChange, { kind: 'delete' }>;
}

export type PageParse =
  { readonly ok: true; readonly page: ChangesPage } | { readonly ok: true; readonly resync: ResyncRequired } | { readonly ok: false };

/** Page-level shape. `limit` is the number requested: more changes than that is a malformed page. */
export function parsePage(body: unknown, limit: number): PageParse {
  if (!isObject(body)) return { ok: false };
  const serverTime = parseServerTime(body['serverTime']);
  if (serverTime === undefined) return { ok: false };
  if (body['result'] === 'resync_required') {
    const reason = body['reason'];
    const mapped: ResyncReason =
      typeof reason === 'string' && (RESYNC_REASONS as readonly string[]).includes(reason) && reason !== 'invalid_change'
        ? (reason as ResyncReason)
        : 'periodic';
    if (typeof reason !== 'string' || reason.length > 32) return { ok: false };
    return { ok: true, resync: { result: 'resync_required', reason: mapped, serverTime } };
  }
  if (body['result'] !== 'changes') return { ok: false };
  const { phase, changes, cursor, hasMore } = body;
  if (phase !== 'snapshot' && phase !== 'changes') return { ok: false };
  if (!Array.isArray(changes) || changes.length > Math.min(limit, 500)) return { ok: false };
  if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor) || typeof hasMore !== 'boolean') return { ok: false };
  return {
    ok: true,
    page: { result: 'changes', phase, changes: changes as unknown[], cursor, hasMore, serverTime },
  };
}

export function parseSnapshot(body: unknown): WorkOrderSnapshot | null {
  if (!isObject(body)) return null;
  const serverTime = parseServerTime(body['serverTime']);
  const entities = body['entities'];
  if (serverTime === undefined || !Array.isArray(entities) || entities.length > 2000) return null;
  return { serverTime, entities: entities as unknown[] };
}

const intIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

/** Validates the config like any server data. The offline window can only be shortened, never beyond the 7-day baseline. */
export function parseClientConfig(body: unknown): ClientConfig {
  const d = DEFAULT_CLIENT_CONFIG;
  if (!isObject(body)) return d;
  const version = body['scopeRuleVersion'];
  const scopeRuleVersion =
    typeof version === 'number' && Number.isInteger(version) && version >= 0 && version <= MAX_INT
      ? String(version)
      : typeof version === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(version)
        ? version
        : d.scopeRuleVersion;
  return {
    offlineContactWindowDays: intIn(body['offlineContactWindowDays'], 1, 7) ?? d.offlineContactWindowDays,
    closedWorkOrdersInScopeDays: intIn(body['closedWorkOrdersInScopeDays'], 1, 365) ?? d.closedWorkOrdersInScopeDays,
    periodicResyncDays: intIn(body['periodicResyncDays'], 1, 90) ?? d.periodicResyncDays,
    scopeRuleVersion,
  };
}
