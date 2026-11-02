import type { Clock, QueueStore, SessionOwner } from './ports.ts';
import { CLIENT_ID_PATTERN, MAX_MUTATION_BYTES, QueueError, UUID_PATTERN, type QueueRecord } from './types.ts';
import { deriveKeys, isMutationType, KEY_FIELDS, parseEntry, wireBytes } from './validate.ts';

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

export interface DiscardResult {
  /** Entries removed in total (the root and everything that depended on it). */
  readonly removed: number;
  /** Entries removed together with the root (for the confirmation dialog: "and N dependent items"). */
  readonly dependents: number;
}

export interface RecreateInput {
  /** Corrected data (e.g. the quick work order form); defaults to the payload the entry already has. */
  readonly payload?: unknown;
}

export interface RetargetInput {
  readonly workOrderId: string;
  /** The target must be a work order visible in the local replica; supplied by the host (the queue does not know the replica). */
  readonly isVisibleWorkOrder: (workOrderId: string) => boolean | Promise<boolean>;
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

  /**
   * "Delete from phone": removes the "needs attention" entry and, transitively, everything that depends on it - one transaction.
   * Never automatic: the host calls it after the user's decision (the dialog shows `dependents` beforehand via `groupOf`).
   */
  async discard(mutationId: string): Promise<DiscardResult> {
    const group = await this.#group(mutationId, true);
    await this.#rewrite(
      group.map((r) => r.mutationId),
      [],
    );
    return { removed: group.length, dependents: group.length - 1 };
  }

  /** The entry and the entries that depend on it (for the confirmation dialog); read-only. */
  async groupOf(mutationId: string): Promise<readonly QueueRecord[]> {
    return this.#group(mutationId, true);
  }

  /**
   * "Create again": a NEW mutation (new `mutationId`, the server remembers the rejection under the old one; never an edit in place).
   * `id_conflict` requires a new object id; when the root's id changes, dependents get the new target, parent and ordering key
   * in the same transaction and keep their own object ids.
   */
  async recreate(mutationId: string, input: RecreateInput = {}): Promise<QueueRecord> {
    const group = await this.#group(mutationId, false);
    const [root, ...dependents] = group as [QueueRecord, ...QueueRecord[]];
    const payload = clonePayload(input.payload ?? root.payload);
    const fields = KEY_FIELDS[root.type];
    if (root.lastCode === 'id_conflict' && (input.payload === undefined || payload[fields.objectId] === root.objectId)) {
      payload[fields.objectId] = this.#deps.newId();
      if (fields.orderingKey === fields.objectId) payload[fields.orderingKey] = payload[fields.objectId];
    }
    const keys = deriveKeys(root.type, payload);
    if (keys === null) throw new QueueError('invalid_input');
    const created = this.#fresh(root, { payload, objectId: keys.objectId, orderingKey: keys.orderingKey });
    const idMap = new Map<string, string>([[root.mutationId, created.mutationId]]);
    const moved: QueueRecord[] = [created];
    for (const dep of dependents) {
      const underRoot = dep.orderingKey === root.orderingKey && keys.orderingKey !== root.orderingKey;
      const next = this.#fresh(dep, {
        payload: underRoot ? { ...dep.payload, [KEY_FIELDS[dep.type].orderingKey]: keys.orderingKey } : dep.payload,
        objectId: dep.objectId,
        orderingKey: underRoot ? keys.orderingKey : dep.orderingKey,
        parentMutationId: idMap.get(dep.parentMutationId ?? '') ?? dep.parentMutationId,
      });
      idMap.set(dep.mutationId, next.mutationId);
      moved.push(next);
    }
    await this.#rewrite(
      group.map((r) => r.mutationId),
      moved,
    );
    return created;
  }

  /** "Add to another work order": a note or a comment gets a new target (a visible work order of the replica) and a new mutation id. */
  async retarget(mutationId: string, input: RetargetInput): Promise<QueueRecord> {
    const group = await this.#group(mutationId, false);
    const [root, ...dependents] = group as [QueueRecord, ...QueueRecord[]];
    if (root.type === 'CreateQuickWorkOrder') throw new QueueError('invalid_input');
    const target = input.workOrderId;
    if (!UUID_PATTERN.test(target) || target === root.orderingKey) throw new QueueError('invalid_input');
    if (!(await input.isVisibleWorkOrder(target))) throw new QueueError('invalid_input');
    const payload = { ...root.payload, [KEY_FIELDS[root.type].orderingKey]: target };
    const created = this.#fresh(root, { payload, objectId: root.objectId, orderingKey: target, parentMutationId: undefined });
    const idMap = new Map<string, string>([[root.mutationId, created.mutationId]]);
    const moved: QueueRecord[] = [created];
    for (const dep of dependents) {
      const next = this.#fresh(dep, {
        payload: dep.payload,
        objectId: dep.objectId,
        orderingKey: dep.orderingKey,
        parentMutationId: idMap.get(dep.parentMutationId ?? '') ?? dep.parentMutationId,
      });
      idMap.set(dep.mutationId, next.mutationId);
      moved.push(next);
    }
    await this.#rewrite(
      group.map((r) => r.mutationId),
      moved,
    );
    return created;
  }

  /** The root (must be "needs attention"; for `discard` a blocked dependent also qualifies) and its transitive dependents. */
  async #group(mutationId: string, allowBlocked: boolean): Promise<QueueRecord[]> {
    const ownerUserId = await this.#deps.session.currentUserId();
    if (ownerUserId === null || ownerUserId === '') throw new QueueError('no_session');
    const records = (await this.entries()).flatMap((e) => (e.valid ? [e.record] : []));
    const root = records.find((r) => r.mutationId === mutationId);
    if (root === undefined) throw new QueueError('not_found');
    if (root.ownerUserId !== ownerUserId) throw new QueueError('owner_mismatch');
    if (root.state !== 'needs_attention' && !(allowBlocked && root.state === 'blocked')) throw new QueueError('not_attention');
    const ids = new Set([mutationId]);
    const group: QueueRecord[] = [root];
    for (const r of records) {
      if (r.parentMutationId !== undefined && ids.has(r.parentMutationId)) {
        if (r.ownerUserId !== ownerUserId) throw new QueueError('owner_mismatch');
        ids.add(r.mutationId);
        group.push(r);
      }
    }
    return group;
  }

  #fresh(
    from: QueueRecord,
    next: { payload: Record<string, unknown>; objectId: string; orderingKey: string; parentMutationId?: string | undefined },
  ): QueueRecord {
    const parent = 'parentMutationId' in next ? next.parentMutationId : from.parentMutationId;
    const record: QueueRecord = {
      mutationId: this.#deps.newId(),
      type: from.type,
      commandVersion: from.commandVersion,
      payload: next.payload,
      objectId: next.objectId,
      orderingKey: next.orderingKey,
      ...(parent === undefined ? {} : { parentMutationId: parent }),
      createdAt: from.createdAt,
      ownerUserId: from.ownerUserId,
      state: 'pending',
      attempts: 0,
    };
    if (wireBytes(record) > MAX_MUTATION_BYTES) throw new QueueError('payload_too_large');
    return record;
  }

  async #rewrite(remove: readonly string[], append: readonly QueueRecord[]): Promise<void> {
    try {
      await this.#deps.store.rewrite(remove, append);
    } catch {
      throw new QueueError('storage_failure');
    }
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
