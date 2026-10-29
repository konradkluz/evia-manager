import type { Clock, QueueStore, SessionOwner } from './ports.ts';
import { CLIENT_ID_PATTERN, MAX_MUTATION_BYTES, QueueError, type QueueRecord } from './types.ts';
import { deriveKeys, isMutationType, parseEntry, wireBytes } from './validate.ts';

export interface EnqueueInput {
  readonly type: string;
  readonly commandVersion: number;
  /** A JSON object; the queue stores a copy, so the envelope cannot change after `enqueue`. */
  readonly payload: unknown;
  /** Optional; derived from the payload (`id` or `workOrderId`) and accepted only when equal to it. */
  readonly objectId?: string;
  /** Optional; derived from the payload (`workOrderId`) and accepted only when equal to it. */
  readonly orderingKey?: string;
  /** A mutation that must be applied first (e.g. the quick work order a note belongs to). */
  readonly parentMutationId?: string;
}

export type QueueEntry =
  | { readonly index: number; readonly valid: true; readonly record: QueueRecord }
  | { readonly index: number; readonly valid: false; readonly code: 'corrupt_record' | 'unknown_type'; readonly mutationId?: string };

export interface QueueDeps {
  readonly store: QueueStore;
  readonly clock: Clock;
  readonly session: SessionOwner;
  readonly newId: () => string;
}

/** The durable queue: every entry is saved before `enqueue` resolves, and read back through validation. */
export class MutationQueue {
  readonly #deps: QueueDeps;

  constructor(deps: QueueDeps) {
    this.#deps = deps;
  }

  /** All entries in queue order; a damaged entry is reported, never dropped and never thrown on. */
  async entries(): Promise<QueueEntry[]> {
    const raw = await this.#deps.store.readAll();
    return raw.map((item, index): QueueEntry => {
      const parsed = parseEntry(item);
      return parsed.ok
        ? { index, valid: true, record: parsed.record }
        : { index, valid: false, code: parsed.code, ...(parsed.mutationId === undefined ? {} : { mutationId: parsed.mutationId }) };
    });
  }

  async enqueue(input: EnqueueInput): Promise<QueueRecord> {
    const ownerUserId = await this.#deps.session.currentUserId();
    if (ownerUserId === null || ownerUserId === '') throw new QueueError('no_session');
    if (!isMutationType(input.type)) throw new QueueError('invalid_input');
    const { commandVersion } = input;
    if (!Number.isInteger(commandVersion) || commandVersion < 1 || commandVersion > 1000) throw new QueueError('invalid_input');
    const payload = clonePayload(input.payload);
    const keys = deriveKeys(input.type, payload);
    if (keys === null) throw new QueueError('invalid_input');
    const { objectId, orderingKey } = keys;
    if (input.objectId !== undefined && input.objectId !== objectId) throw new QueueError('invalid_input');
    if (input.orderingKey !== undefined && input.orderingKey !== orderingKey) throw new QueueError('invalid_input');
    const { parentMutationId } = input;
    if (parentMutationId !== undefined && !CLIENT_ID_PATTERN.test(parentMutationId)) throw new QueueError('invalid_input');

    let dependsOn: string | undefined;
    if (parentMutationId !== undefined) {
      const parent = (await this.entries()).find((entry) => entry.valid && entry.record.mutationId === parentMutationId);
      // A parent that is no longer in the queue has been applied: the dependency is satisfied.
      if (parent?.valid === true) {
        if (parent.record.ownerUserId !== ownerUserId) throw new QueueError('owner_mismatch');
        dependsOn = parentMutationId;
      }
    }

    const record: QueueRecord = {
      mutationId: this.#deps.newId(),
      type: input.type,
      commandVersion,
      payload,
      objectId,
      orderingKey,
      ...(dependsOn === undefined ? {} : { parentMutationId: dependsOn }),
      createdAt: this.#deps.clock.now(),
      ownerUserId,
      state: 'pending',
      attempts: 0,
    };
    if (wireBytes(record) > MAX_MUTATION_BYTES) throw new QueueError('payload_too_large');
    try {
      await this.#deps.store.append(record);
    } catch {
      throw new QueueError('storage_failure');
    }
    return record;
  }
}

function clonePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new QueueError('invalid_input');
  try {
    const text = JSON.stringify(payload);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new QueueError('invalid_input');
  }
}
