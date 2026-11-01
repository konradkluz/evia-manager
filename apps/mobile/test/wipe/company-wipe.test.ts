import { CompanyDataWipe, type WipeConfirmOutcome, type WipeHost, type WipePhase } from '../../src/wipe/company-wipe';
import { InstallationProof } from '../../src/storage/installation-proof';

const PROOF = InstallationProof.of({ deviceId: 'device-synthetic', secret: 'secret-synthetic' });

function rig() {
  const state = {
    now: 1_000_000,
    wipeResult: 'done' as 'done' | 'incomplete' | 'throws',
    prepare: 'ready' as 'ready' | 'wipe_incomplete' | 'throws',
    owed: false,
    cleared: 0,
    wipes: [] as (boolean | undefined)[],
    sent: 0,
    answers: [] as (WipeConfirmOutcome | 'throws')[],
    unsent: 3 as number | 'throws',
    pendingThrows: false,
  };
  const host: WipeHost = {
    unsentItemCount: () => (state.unsent === 'throws' ? Promise.reject(new Error('x')) : Promise.resolve(state.unsent)),
    wipeCompanyData: (options) => {
      state.wipes.push(options?.confirmToServer);
      if (state.wipeResult === 'throws') return Promise.reject(new Error('x'));
      if (state.wipeResult === 'done' && options?.confirmToServer === true) state.owed = true;
      return Promise.resolve(state.wipeResult);
    },
    prepare: () => (state.prepare === 'throws' ? Promise.reject(new Error('x')) : Promise.resolve(state.prepare)),
    pendingWipeConfirmation: () => (state.pendingThrows ? Promise.reject(new Error('x')) : Promise.resolve(state.owed ? PROOF : null)),
    clearWipeConfirmation: () => {
      state.cleared += 1;
      state.owed = false;
      return Promise.resolve();
    },
  };
  const events: unknown[] = [];
  const phases: WipePhase[] = [];
  const wipe = new CompanyDataWipe({
    host,
    client: {
      confirmWipe: () => {
        state.sent += 1;
        const next = state.answers.shift() ?? { kind: 'unavailable' as const };
        return next === 'throws' ? Promise.reject(new Error('x')) : Promise.resolve(next);
      },
    },
    now: () => state.now,
    diagnostics: (event) => events.push(event),
  });
  wipe.onPhase((phase) => phases.push(phase));
  return { wipe, state, events, phases };
}

describe('wipe of company data (EVM-101 AC4, SR-MOB-04)', () => {
  it('EVM-101 AC4: the dialog reads the number of unsent items; an unreadable store counts as 0', async () => {
    const r = rig();
    expect(await r.wipe.unsentItemCount()).toBe(3);
    r.state.unsent = 'throws';
    expect(await r.wipe.unsentItemCount()).toBe(0);
  });

  it('EVM-101 AC4: the manual wipe runs the host once, asks nothing of the server, owes no confirmation', async () => {
    const r = rig();
    expect(await r.wipe.runManual()).toBe('done');
    expect(r.state.wipes).toEqual([false]);
    expect(r.state.sent).toBe(0);
    expect(r.phases).toEqual(['wiping', 'idle']);
  });

  it('EVM-101 AC4: device_wipe_required wipes at once (no question) and confirms to the server after the data are gone', async () => {
    const r = rig();
    r.state.answers.push({ kind: 'confirmed' });
    r.wipe.wipeRequired();
    await r.wipe.resume();
    expect(r.state.wipes[0]).toBe(true);
    expect(r.state.sent).toBe(1);
    expect(r.state.cleared).toBe(1);
    expect(r.events).toEqual([{ event: 'wipe-confirmation', outcome: 'sent' }]);
  });

  it.each([
    ['confirmed (204)', { kind: 'confirmed' } as const, 1, 'sent'],
    ['rejected (401 invalid_credentials)', { kind: 'rejected' } as const, 1, 'rejected'],
  ])('EVM-101 AC4: %s deletes the slot', async (_name, answer, cleared, outcome) => {
    const r = rig();
    r.state.answers.push(answer);
    await r.wipe.runRequired();
    expect(r.state.cleared).toBe(cleared);
    expect(r.events).toEqual([{ event: 'wipe-confirmation', outcome }]);
  });

  it.each([{ kind: 'unavailable' } as const, 'throws' as const])(
    'EVM-101 AC4: %p keeps the slot and the next start or return tries again',
    async (answer) => {
      const r = rig();
      r.state.answers.push(answer, { kind: 'confirmed' });
      await r.wipe.runRequired();
      expect(r.state.cleared).toBe(0);
      expect(r.state.owed).toBe(true);
      await r.wipe.resume();
      expect(r.state.sent).toBe(2);
      expect(r.state.cleared).toBe(1);
    },
  );

  it('EVM-101 AC4: 429 waits for Retry-After; the slot stays; afterwards the next try goes out', async () => {
    const r = rig();
    r.state.answers.push({ kind: 'rate_limited', retryAfterMs: 30_000 }, { kind: 'confirmed' });
    await r.wipe.runRequired();
    await r.wipe.resume();
    expect(r.state.sent).toBe(1);
    r.state.now += 29_999;
    await r.wipe.resume();
    expect(r.state.sent).toBe(1);
    r.state.now += 2;
    await r.wipe.resume();
    expect(r.state.sent).toBe(2);
    expect(r.state.cleared).toBe(1);
  });

  it('EVM-101 AC4: nothing is owed -> no request; an unreadable slot sends nothing', async () => {
    const r = rig();
    await r.wipe.resume();
    expect(r.state.sent).toBe(0);
    r.state.owed = true;
    r.state.pendingThrows = true;
    await r.wipe.resume();
    expect(r.state.sent).toBe(0);
  });

  it('EVM-101 AC4: an incomplete wipe keeps the hidden-data phase and sends no confirmation; resume finishes it (interrupted wipe)', async () => {
    const r = rig();
    r.state.wipeResult = 'incomplete';
    expect(await r.wipe.runRequired()).toBe('incomplete');
    expect(r.wipe.phase).toBe('incomplete');
    expect(r.state.sent).toBe(0);
    r.state.prepare = 'wipe_incomplete';
    await r.wipe.resume();
    expect(r.wipe.phase).toBe('incomplete');
    r.state.prepare = 'ready';
    r.state.owed = true;
    r.state.answers.push({ kind: 'confirmed' });
    await r.wipe.resume();
    expect(r.wipe.phase).toBe('idle');
    expect(r.state.cleared).toBe(1);
  });

  it('EVM-101 AC4: a host that throws is an incomplete wipe, never an exception', async () => {
    const r = rig();
    r.state.wipeResult = 'throws';
    expect(await r.wipe.runManual()).toBe('incomplete');
    r.state.prepare = 'throws';
    await expect(r.wipe.resume()).resolves.toBeUndefined();
    expect(r.wipe.phase).toBe('incomplete');
  });

  it('EVM-101 AC4: the phase listeners can be removed', async () => {
    const r = rig();
    const seen: WipePhase[] = [];
    const off = r.wipe.onPhase((phase) => seen.push(phase));
    off();
    await r.wipe.runManual();
    expect(seen).toEqual([]);
  });

  it('EVM-101 AC4 (SR-LOG-08): diagnostics carry the outcome code only - no pair, no secret', async () => {
    const r = rig();
    r.state.answers.push({ kind: 'unavailable' });
    await r.wipe.runRequired();
    expect(JSON.stringify(r.events)).toBe('[{"event":"wipe-confirmation","outcome":"retry"}]');
    expect(JSON.stringify(r.events)).not.toContain('synthetic');
  });
});
