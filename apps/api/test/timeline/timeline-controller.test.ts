import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CreateEntryService } from '../../src/modules/timeline/application/create-entry.service.ts';
import type { ListEntriesService } from '../../src/modules/timeline/application/list-entries.service.ts';
import type { ReadEntryService } from '../../src/modules/timeline/application/read-entry.service.ts';
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
  const get = vi.fn(() => Promise.resolve(ENTRY));
  const create = vi.fn(() => Promise.resolve({ entry: ENTRY, replayed }));
  const controller = new TimelineController(
    { list } as unknown as ListEntriesService,
    { get } as unknown as ReadEntryService,
    { create } as unknown as CreateEntryService,
  );
  return { list, get, create, controller };
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
    await expect(controller.getTimelineEntry(params, await signedIn())).resolves.toBe(ENTRY);
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
    expect(() => controller.getTimelineEntry({}, anonymous)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
    await expect(controller.createTimelineEntry({}, {}, undefined, anonymous, response().reply)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
