import { must, notePayload, Phone, ScriptedServer, page, aggregate, settle } from './harness';

// EVM-106 AC1 (security K1, K2, K3, K5): the template list is fetched after a finished cycle, through the shared session gate.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const body = (names: string[]) => ({
  items: names.map((name, index) => ({
    id: `0194c2a0-0000-7000-8000-00000000a0${String(index + 1)}0`.slice(0, 36),
    code: `code_${String(index)}`,
    name,
    siteTypeHint: index === 1 ? 'multi_family_garage' : null,
    isActive: true,
    items: [],
    procedures: [],
    paymentMilestones: [],
  })),
  nextCursor: null,
});
const ok = (names: string[] = ['Wallbox w domu']) => ({ kind: 'ok' as const, body: body(names) });
const USER_A = '0194c2a0-0000-7000-8000-0000000000b1';
const USER_B = '0194c2a0-0000-7000-8000-0000000000b2';

async function started(server: ScriptedServer, extra = {}) {
  server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  const service = phone.service(server, extra);
  await service.start();
  await settle();
  return service;
}
const names = async (service: { templates(): Promise<{ items: readonly { name: string }[] } | null> }) =>
  must(await service.templates()).items.map((t) => t.name);
const again = async (service: { trigger(): void }) => {
  phone.clockNow += 60_000;
  service.trigger();
  await settle();
};

describe('templates after a cycle (EVM-106 AC1)', () => {
  it('EVM-106 AC1: after the first download the active templates are stored in the replica and readable offline', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Wallbox w domu', 'Garaż']);
    const service = await started(server);
    expect(await names(service)).toEqual(['Wallbox w domu', 'Garaż']);
    expect(must(await service.templates()).items[1]?.siteTypeHint).toBe('multi_family_garage');
    expect(server.templateCalls).toBe(1);
    phone.online = false;
    expect(must(await service.templates()).items).toHaveLength(2);
  });

  it('EVM-106 AC1: every cycle replaces the set as a whole; an answer that is not the contract leaves the old set', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Pierwszy']);
    const service = await started(server);
    server.templates = ok(['Drugi', 'Trzeci']);
    await again(service);
    expect(await names(service)).toEqual(['Drugi', 'Trzeci']);
    server.templates = { kind: 'ok', body: { items: [{ id: 'x' }] } };
    await again(service);
    expect(await names(service)).toEqual(['Drugi', 'Trzeci']);
    expect(service.getSnapshot().failure).toBeNull();
  });

  it.each([
    ['5xx', { kind: 'http', status: 503 } as const],
    ['429', { kind: 'http', status: 429 } as const],
    ['a network error', { kind: 'network' } as const],
    ['404', { kind: 'http', status: 404, code: 'not_found' } as const],
  ])('EVM-106 AC1: %s keeps the old set, no pause, no failure and the contact stays as it was', async (_name, reply) => {
    const server = new ScriptedServer();
    server.templates = ok(['Stary']);
    const service = await started(server);
    const last = service.getSnapshot().lastSuccessAt;
    server.templates = reply;
    await again(service);
    expect(await names(service)).toEqual(['Stary']);
    expect(phone.pauses).toEqual([]);
    expect(service.getSnapshot()).toMatchObject({ paused: null, failure: null });
    expect(last).not.toBeNull();
  });

  it('EVM-106 AC1: a cycle that ends with 429 on pull or push does not ask for the templates (a successful cycle does: the tests above)', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Stary']);
    const service = await started(server);
    const calls = server.templateCalls;
    server.changes.push({ kind: 'http', status: 429, code: 'rate_limited', retryAfter: '30' });
    await again(service);
    expect(service.getSnapshot().failure).toBe('rate_limited');
    server.pushScript.push({ kind: 'http', status: 429, retryAfter: '30' });
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1) });
    await settle();
    expect(server.templateCalls).toBe(calls);
  });

  it('EVM-106 AC1: a cycle that ends with a network or 5xx error on pull does not ask for the templates', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Stary']);
    const service = await started(server);
    const calls = server.templateCalls;
    server.changes.push({ kind: 'network' });
    await again(service);
    expect(service.getSnapshot().failure).toBe('pull');
    server.changes.push({ kind: 'http', status: 503 });
    await again(service);
    expect(service.getSnapshot().failure).toBe('pull');
    expect(server.templateCalls).toBe(calls);
  });

  it('EVM-106 AC1: a thrown transport error keeps the old set quietly', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Stary']);
    const service = await started(server);
    server.templates = () => {
      throw new Error('boom');
    };
    await again(service);
    expect(await names(service)).toEqual(['Stary']);
    expect(service.getSnapshot().failure).toBeNull();
  });

  it.each(['forbidden', 'channel_not_allowed'])(
    'EVM-106 AC1: 403 %s pauses through the gate (the screen of "no access") and keeps the old set; no loop',
    async (code) => {
      const server = new ScriptedServer();
      server.templates = ok(['Stary']);
      const service = await started(server);
      server.templates = { kind: 'http', status: 403, code };
      await again(service);
      expect(phone.pauses).toEqual(['forbidden']);
      expect(service.getSnapshot().paused).toBe('forbidden');
      expect(await names(service)).toEqual(['Stary']);
      const calls = server.templateCalls;
      for (let i = 0; i < 3; i += 1) await again(service);
      expect(server.templateCalls).toBe(calls);
    },
  );

  it('EVM-106 AC1: 426 pauses with upgrade_required (the same screen as for push and pull)', async () => {
    const server = new ScriptedServer();
    const service = await started(server);
    server.templates = { kind: 'http', status: 426, code: 'client_version_unsupported' };
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1) });
    await settle();
    await again(service);
    expect(phone.pauses).toContain('upgrade_required');
    expect(service.getSnapshot().paused).toBe('upgrade_required');
  });

  it('EVM-106 AC1: 401 refreshes the token once and asks once more (no loop), then stores the set', async () => {
    const server = new ScriptedServer();
    let refreshed = 0;
    let calls = 0;
    server.templates = () => {
      calls += 1;
      return calls === 1 ? { kind: 'http', status: 401, code: 'unauthorized' } : ok(['Po odświeżeniu']);
    };
    const service = await started(server, {
      owner: {
        currentUserId: () => Promise.resolve(USER_A),
        refresh: () => {
          refreshed += 1;
          return Promise.resolve('refreshed' as const);
        },
      },
    });
    expect(refreshed).toBe(1);
    expect(calls).toBe(2);
    expect(await names(service)).toEqual(['Po odświeżeniu']);
  });

  it('EVM-106 AC1: 401 that stays 401 after the refresh pauses (auth_required) instead of looping', async () => {
    const server = new ScriptedServer();
    server.templates = { kind: 'http', status: 401, code: 'unauthorized' };
    const service = await started(server);
    expect(server.templateCalls).toBe(2);
    expect(service.getSnapshot().paused).toBe('auth_required');
  });

  it.each(['session_revoked', 'device_wipe_required'])('EVM-106 AC1: 401 %s takes the same path as push and pull', async (code) => {
    const server = new ScriptedServer();
    server.templates = { kind: 'http', status: 401, code };
    const service = await started(server);
    expect(phone.pauses).toEqual([code]);
    expect(server.templateCalls).toBe(1);
    expect(service.getSnapshot().paused).toBe(code);
  });

  it('EVM-106 AC1: no request while the data are hidden (7-day rule)', async () => {
    const server = new ScriptedServer();
    phone.contactVisible = false;
    await started(server);
    expect(server.templateCalls).toBe(0);
  });

  it('EVM-106 AC1: no template request after the cycle was paused by push (426)', async () => {
    const server = new ScriptedServer();
    server.pushScript.push({ kind: 'http', status: 426 });
    const service = phone.service(server);
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    await service.start();
    await service.enqueue({ type: 'CreateNote', commandVersion: 1, payload: notePayload(1) });
    await again(service);
    expect(phone.pauses).toEqual(['upgrade_required']);
    const calls = server.templateCalls;
    await again(service);
    expect(server.templateCalls).toBe(calls);
  });

  it('EVM-106 AC1: a sign-out or a wipe during the request does not bring the set back', async () => {
    const server = new ScriptedServer();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.templates = async () => {
      await hold;
      return ok(['Spóźniony']);
    };
    const service = phone.service(server);
    server.changes.push(page(aggregate(1), { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    await service.start();
    await settle();
    service.dispose();
    await phone.replica.wipeReplica();
    release();
    await settle();
    expect(await phone.replica.readTemplates()).toBeNull();
  });

  it('EVM-106 AC1: another user in the session at the moment of the answer: nothing is stored', async () => {
    const server = new ScriptedServer();
    let user = USER_A;
    server.templates = () => {
      user = USER_B;
      return ok(['Obcy']);
    };
    await started(server, { owner: { currentUserId: () => Promise.resolve(user), refresh: () => Promise.resolve('refreshed' as const) } });
    expect(await phone.replica.readTemplates()).toBeNull();
  });

  it('EVM-106 AC1: wipeReplica removes the templates together with the rest', async () => {
    const server = new ScriptedServer();
    server.templates = ok();
    await started(server);
    expect(await phone.replica.readTemplates()).not.toBeNull();
    await phone.replica.wipeReplica();
    expect(await phone.replica.readTemplates()).toBeNull();
  });

  it('EVM-106 AC1: a failed write leaves the old set; nothing is logged and nothing is shown', async () => {
    const server = new ScriptedServer();
    server.templates = ok(['Stary']);
    const service = await started(server);
    const spies = (['error', 'warn', 'log', 'info'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const original = phone.replica.writeTemplates.bind(phone.replica);
    phone.replica.writeTemplates = () => Promise.reject(new Error('Wallbox w domu 600 000 001'));
    server.templates = ok(['Nowy']);
    await again(service);
    phone.replica.writeTemplates = original;
    expect(await names(service)).toEqual(['Stary']);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    expect(service.getSnapshot().failure).toBeNull();
  });

  it('EVM-106 AC1: templates stay readable while the data are hidden (not personal data); the customers are not read', async () => {
    const server = new ScriptedServer();
    server.templates = ok();
    const service = await started(server);
    phone.contactVisible = false;
    expect(must(await service.templates()).items).toHaveLength(1);
    expect(await service.quickOrderSource()).toEqual({ customers: [], sites: [] });
  });
});
