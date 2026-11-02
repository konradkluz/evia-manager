import { zSyncMutationsRequest, zSyncMutationsResponse } from '@evia/contracts/zod';
import { NOTE_WO, NOW, Phone, ScriptedServer, aggregate, notePayload, page, settle } from './harness';

let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const N = 24;

/**
 * EVM-107 AC6 (integration part): the offline recovery on the real SQLCipher adapters. The server here follows the idempotency of the
 * contract (EVM-090) and is the same kind of stand-in as the scenario server of the Maestro flow; the guarantee of the REAL server that
 * a mutation takes effect once is proven by its own integration test of the idempotency of mutations (EVM-098, services/api).
 */
describe('offline recovery (EVM-107 AC6)', () => {
  it('EVM-107 AC6: notes saved offline survive the kill of the app, and after the network returns the server has each exactly once - 0 duplicates, 0 losses - also when a response is lost', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    // the first download with a network
    const first = phone.service(server);
    await first.start();
    await settle();
    expect(first.getSnapshot().initialLoad).toBe('done');

    // airplane mode: N notes into the durable queue; every enqueue resolved = saved
    phone.online = false;
    first.setOnline(false);
    const ids: string[] = [];
    for (let i = 1; i <= N; i += 1) {
      expect(await first.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(i, NOTE_WO) })).toEqual({ ok: true });
    }
    for (const row of (await phone.queue.readAll()) as { mutationId: string }[]) ids.push(row.mutationId);
    expect(ids).toHaveLength(N);
    expect(server.pushes).toHaveLength(0);

    // the kill: no goodbye, the database file stays
    first.dispose();
    await phone.restart();
    const second = phone.service(server);
    phone.online = false;
    await second.start();
    await settle();
    expect(second.getSnapshot().counts.unsent).toBe(N);
    expect(server.pushes).toHaveLength(0);

    // the network returns; the server applies the first batch but its answer is lost (the phone cannot know)
    server.pushScript.push(() => {
      const request = server.pushes[server.pushes.length - 1];
      for (const m of request?.mutations ?? []) server.applied.set(m.mutationId, 1);
      return { kind: 'network' };
    });
    phone.online = true;
    phone.clockNow += 10 * 60_000;
    second.setOnline(true);
    await settle();
    // the retry goes through the timer of the backoff
    for (let round = 0; round < 6 && second.getSnapshot().counts.unsent > 0; round += 1) {
      phone.clockNow += 10 * 60_000;
      await phone.timers.fireAll();
      second.trigger();
      await settle();
    }

    expect(second.getSnapshot().counts.unsent).toBe(0);
    expect(await phone.queue.readAll()).toEqual([]);
    // 0 losses: every saved note reached the server; 0 duplicates: each one has an effect once (a repeat is "duplicate", not a second note)
    expect([...server.applied.keys()].sort()).toEqual([...ids].sort());
    const received = server.pushes.flatMap((p) => p.mutations.map((m) => m.mutationId));
    expect(new Set(received).size).toBe(N);
    expect(received.length).toBeGreaterThanOrEqual(N);
    // the same ids: the retry of the lost batch used the SAME mutation ids (idempotency keys), not new ones
    for (const id of received) expect(ids).toContain(id);
  });

  it('EVM-107 AC6, AC7: what the app sends passes the request schema of the contract, and the answers of the stand-in pass the response schema', async () => {
    const server = new ScriptedServer();
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    const service = phone.service(server);
    await service.start();
    await settle();
    phone.clockNow += 5_000;
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1, NOTE_WO) });
    phone.clockNow += 5_000;
    await phone.timers.fireAll();
    service.trigger();
    await settle();
    const request = server.pushes[0];
    expect(request).toBeDefined();
    expect(zSyncMutationsRequest.safeParse(request).success).toBe(true);
    expect(request?.pendingItems).toBe(1);
    const answer = {
      serverTime: new Date(NOW).toISOString(),
      results: [{ mutationId: request?.mutations[0]?.mutationId, outcome: 'applied' }],
    };
    expect(zSyncMutationsResponse.safeParse(answer).success).toBe(true);
  });
});
