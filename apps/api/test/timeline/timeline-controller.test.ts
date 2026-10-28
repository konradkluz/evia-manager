import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CreateEntryService } from '../../src/modules/timeline/application/create-entry.service.ts';
import type { DeleteEntryService } from '../../src/modules/timeline/application/delete-entry.service.ts';
import type { ListEntriesService } from '../../src/modules/timeline/application/list-entries.service.ts';
import type { ReadEntryService } from '../../src/modules/timeline/application/read-entry.service.ts';
import type { RedactEntryService } from '../../src/modules/timeline/application/redact-entry.service.ts';
import type { RestoreEntryService } from '../../src/modules/timeline/application/restore-entry.service.ts';
import { TimelineController } from '../../src/modules/timeline/http/timeline.controller.ts';
import { resolveAuthentication } from '../../src/platform/http/principal.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { principal, resolverOf } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The controller over FAKE services: it holds no authorization (the guard decides before it) and no logic — it passes the principal
// and the raw input to the use case and sets the headers of the answer. A request that the guard would have stopped has no principal.
const ENTRY = { id: uuidv7() };
const ORDER = uuidv7();

async function signedIn(): Promise<Request> {
  const request = { ip: '203.0.113.9' } as unknown as Request;
  await new Promise<void>((resolve) => {
    resolveAuthentication(resolverOf({ principal: principal({ role: 'editor' }) }), createLogger({ level: 'fatal' }))(
      request,
      {} as Response,
      () => {
        resolve();
      },
    );
  });
  return request;
}
function response() {
  const set = vi.fn();
  return { set, reply: { set, locals: {} } as unknown as Response };
}

function setup(replayed = false) {
  const list = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
  const get = vi.fn(() => Promise.resolve({ entry: ENTRY, version: 3 }));
  const create = vi.fn(() => Promise.resolve({ entry: ENTRY, replayed }));
  const remove = vi.fn(() => Promise.resolve(replayed));
  const restore = vi.fn(() => Promise.resolve({ entry: ENTRY, version: 5, replayed }));
  const redact = vi.fn(() => Promise.resolve({ entry: ENTRY, version: 6 }));
  const controller = new TimelineController(
    { list } as unknown as ListEntriesService,
    { get } as unknown as ReadEntryService,
    { create } as unknown as CreateEntryService,
    { delete: remove } as unknown as DeleteEntryService,
    { restore } as unknown as RestoreEntryService,
    { redact } as unknown as RedactEntryService,
  );
  return { list, get, create, remove, restore, redact, controller };
}

describe('the controller of the journal (EVM-037 AC1, AC5, AC6, AC8; SR-AUTHZ-01)', () => {
  it('EVM-037 AC6 the list passes the principal of the session, the path and the query to the use case, and returns its answer', async () => {
    const { list, controller } = setup();
    const params = { workOrderId: ORDER };
    const query = { kind: 'note' };
    await expect(controller.listTimelineEntries(params, query, await signedIn())).resolves.toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ role: 'editor' }), params, query);
  });

  it('EVM-037 AC7 the read of one entry passes the principal and the path', async () => {
    const { get, controller } = setup();
    const params = { workOrderId: ORDER, entryId: ENTRY.id };
    const { set, reply } = response();
    await expect(controller.getTimelineEntry(params, await signedIn(), reply)).resolves.toBe(ENTRY);
    // the version of the entry is the ETag: the If-Match of the deletion, the restoration and the redaction (EVM-040)
    expect(set).toHaveBeenCalledWith('ETag', '"3"');
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ role: 'editor' }), params);
  });

  it('EVM-037 AC1 the creation passes the body and the key untouched and answers with the Location of the entry — and no replay header', async () => {
    const { create, controller } = setup(false);
    const { set, reply } = response();
    const params = { workOrderId: ORDER };
    const body = { id: ENTRY.id, kind: 'comment', body: 'Komentarz.' };
    const key = uuidv7();
    await expect(controller.createTimelineEntry(params, body, key, await signedIn(), reply)).resolves.toBe(ENTRY);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      body,
      key,
      expect.objectContaining({ origin: 'web' }),
    );
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('Location', `/api/v1/work-orders/${ORDER}/timeline/${ENTRY.id}`);
  });

  it('EVM-037 AC5 a repeat of the creation (same key) says so: Idempotent-Replayed: true', async () => {
    const { controller } = setup(true);
    const { set, reply } = response();
    await controller.createTimelineEntry({ workOrderId: ORDER }, {}, uuidv7(), await signedIn(), reply);
    expect(set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-037 AC8 a request without a principal (one the guard would have stopped) is 401 unauthenticated — the use case is never called', async () => {
    const { list, get, create, controller } = setup();
    const anonymous = {} as unknown as Request;
    expect(() => controller.listTimelineEntries({}, {}, anonymous)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
    await expect(controller.getTimelineEntry({}, anonymous, response().reply)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(controller.createTimelineEntry({}, {}, undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the controller of the deletion, the restoration and the redaction (EVM-040 AC1, AC2, AC6)', () => {
  const params = { workOrderId: ORDER, entryId: ENTRY.id };

  it('EVM-040 AC1 the deletion passes the headers untouched, answers without a body and marks a repeat', async () => {
    const first = setup(false);
    const { set, reply } = response();
    await expect(first.controller.deleteTimelineEntry(params, '"2"', 'key', await signedIn(), reply)).resolves.toBeUndefined();
    expect(first.remove).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"2"',
      'key',
      expect.objectContaining({ origin: 'web' }),
    );
    expect(set).not.toHaveBeenCalled();

    const repeat = setup(true);
    const again = response();
    await repeat.controller.deleteTimelineEntry(params, '"2"', 'key', await signedIn(), again.reply);
    expect(again.set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-040 AC1 the restoration answers with the entry and the ETag of its new version, and marks a repeat', async () => {
    const { restore, controller } = setup(true);
    const { set, reply } = response();
    await expect(controller.restoreTimelineEntry(params, '"4"', 'key', await signedIn(), reply)).resolves.toBe(ENTRY);
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"4"',
      'key',
      expect.objectContaining({ origin: 'web' }),
    );
    expect(set).toHaveBeenCalledWith('ETag', '"5"');
    expect(set).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('EVM-040 AC2 the redaction answers with the entry and the ETag of its new version', async () => {
    const { redact, controller } = setup();
    const { set, reply } = response();
    await expect(controller.redactTimelineEntry(params, '"5"', await signedIn(), reply)).resolves.toBe(ENTRY);
    expect(redact).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'editor' }),
      params,
      '"5"',
      expect.objectContaining({ origin: 'web' }),
    );
    expect(set).toHaveBeenCalledWith('ETag', '"6"');
  });

  it('EVM-040 AC6 a request without a principal is 401 unauthenticated - the use cases are never called', async () => {
    const { remove, restore, redact, controller } = setup();
    const anonymous = {} as unknown as Request;
    await expect(controller.deleteTimelineEntry({}, undefined, undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(controller.restoreTimelineEntry({}, undefined, undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(controller.redactTimelineEntry({}, undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const call of [remove, restore, redact]) expect(call).not.toHaveBeenCalled();
  });
});
