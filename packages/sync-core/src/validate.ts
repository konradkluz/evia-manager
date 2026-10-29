import {
  CLIENT_ID_PATTERN,
  CODE_PATTERN,
  MAX_MUTATION_BYTES,
  MUTATION_TYPES,
  QUEUE_STATES,
  UUID_PATTERN,
  type MutationType,
  type QueueRecord,
  type QueueState,
  type WireMutation,
} from './types.ts';
import { utf8Length } from './util.ts';

export type ParsedEntry =
  | { readonly ok: true; readonly record: QueueRecord }
  | { readonly ok: false; readonly code: 'corrupt_record' | 'unknown_type'; readonly mutationId?: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length >= 1 && value.length <= max;

export function isMutationType(value: unknown): value is MutationType {
  return typeof value === 'string' && (MUTATION_TYPES as readonly string[]).includes(value);
}

/**
 * Which payload fields identify the object and the FIFO aggregate, per type (offline-sync.md, "Komendy mobilne MVP"; paths/sync.yaml).
 * Own map, no import of the contract; a contract test checks that these fields exist in the payload schemas.
 */
export const KEY_FIELDS: Readonly<Record<MutationType, { readonly objectId: string; readonly orderingKey: string }>> = {
  CreateNote: { objectId: 'id', orderingKey: 'workOrderId' },
  CreateComment: { objectId: 'id', orderingKey: 'workOrderId' },
  CreateQuickWorkOrder: { objectId: 'workOrderId', orderingKey: 'workOrderId' },
};

/** The object id and FIFO key the payload carries, or `null` when a field is missing or is not a UUID. */
export function deriveKeys(
  type: MutationType,
  payload: Readonly<Record<string, unknown>>,
): { objectId: string; orderingKey: string } | null {
  const fields = KEY_FIELDS[type];
  const objectId = payload[fields.objectId];
  const orderingKey = payload[fields.orderingKey];
  if (typeof objectId !== 'string' || !UUID_PATTERN.test(objectId)) return null;
  if (typeof orderingKey !== 'string' || !UUID_PATTERN.test(orderingKey)) return null;
  return { objectId, orderingKey };
}

/** Byte size of the envelope as it goes on the wire. */
export function wireBytes(wire: WireMutation): number {
  return utf8Length(JSON.stringify(wire));
}

export function toWire(record: QueueRecord): WireMutation {
  return { mutationId: record.mutationId, type: record.type, commandVersion: record.commandVersion, payload: record.payload };
}

/**
 * Validates an entry read from the store (SR-MOB-10): the envelope and its bounds only — types, UUIDv7, `commandVersion` 1–1000,
 * size. The payload is validated by the server. Failure never carries values of the entry, only a fixed code.
 */
export function parseEntry(raw: unknown): ParsedEntry {
  if (!isObject(raw)) return { ok: false, code: 'corrupt_record' };
  const mutationId = typeof raw['mutationId'] === 'string' && CLIENT_ID_PATTERN.test(raw['mutationId']) ? raw['mutationId'] : undefined;
  const corrupt = (): ParsedEntry => ({ ok: false, code: 'corrupt_record', ...(mutationId === undefined ? {} : { mutationId }) });
  if (mutationId === undefined) return corrupt();
  const {
    type,
    commandVersion,
    payload,
    objectId,
    orderingKey,
    parentMutationId,
    createdAt,
    ownerUserId,
    state,
    attempts,
    lastCode,
    nextAttemptAt,
  } = raw;
  if (typeof type !== 'string') return corrupt();
  if (!isMutationType(type)) return { ok: false, code: 'unknown_type', mutationId };
  if (!isInt(commandVersion, 1, 1000) || !isObject(payload)) return corrupt();
  if (typeof objectId !== 'string' || !UUID_PATTERN.test(objectId)) return corrupt();
  if (typeof orderingKey !== 'string' || !UUID_PATTERN.test(orderingKey)) return corrupt();
  const keys = deriveKeys(type, payload);
  if (keys === null || keys.objectId !== objectId || keys.orderingKey !== orderingKey) return corrupt();
  if (parentMutationId !== undefined && !(typeof parentMutationId === 'string' && CLIENT_ID_PATTERN.test(parentMutationId)))
    return corrupt();
  if (!isInt(createdAt, 0, Number.MAX_SAFE_INTEGER) || !isText(ownerUserId, 128)) return corrupt();
  if (typeof state !== 'string' || !(QUEUE_STATES as readonly string[]).includes(state)) return corrupt();
  if (!isInt(attempts, 0, 1_000_000)) return corrupt();
  if (lastCode !== undefined && !(typeof lastCode === 'string' && CODE_PATTERN.test(lastCode))) return corrupt();
  if (nextAttemptAt !== undefined && !isInt(nextAttemptAt, 0, Number.MAX_SAFE_INTEGER)) return corrupt();
  let size: number;
  try {
    size = wireBytes({ mutationId, type, commandVersion, payload });
  } catch {
    return corrupt();
  }
  if (size > MAX_MUTATION_BYTES) return corrupt();
  return {
    ok: true,
    record: {
      mutationId,
      type,
      commandVersion,
      payload,
      objectId,
      orderingKey,
      ...(parentMutationId === undefined ? {} : { parentMutationId }),
      createdAt,
      ownerUserId,
      state: state as QueueState,
      attempts,
      ...(lastCode === undefined ? {} : { lastCode }),
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
    },
  };
}
