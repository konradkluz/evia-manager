import type { ContactReading } from '../../src/device-guard/device-guard';
import { DAY, MIN, rig } from './fakes';

const settle = async () => {
  for (let n = 0; n < 12; n += 1) await Promise.resolve();
};
const contactOk = (days: number): ContactReading => ({ status: { visible: true, elapsedMs: days * DAY }, windowDays: 7 });

async function started(setup: (r: ReturnType<typeof rig>) => void = () => undefined) {
  const r = rig();
  setup(r);
  r.guard.start();
  await r.guard.signedIn();
  return r;
}

describe('screen lock (EVM-101 AC1, SR-MOB-06)', () => {
  it('EVM-101 AC1: a phone with a screen lock shows the data', async () => {
    const r = await started();
    expect(r.guard.getSnapshot().hidden).toBeNull();
  });

  it('EVM-101 AC1: no screen lock at start -> hidden (screen_lock_off); the lock disappearing during the session hides at the next return', async () => {
    const r = await started();
    r.facts.secure = false;
    r.appState.emit('background');
    r.appState.emit('active');
    await settle();
    expect(r.guard.getSnapshot().hidden).toBe('screen_lock_off');
    r.facts.secure = true;
    await r.guard.refresh();
    expect(r.guard.getSnapshot().hidden).toBeNull();
  });

  it.each(['throws', false] as const)(
    'EVM-101 AC1: an error or "no" of the native check (%s) counts as no lock (fail-closed)',
    async (answer) => {
      const r = await started((x) => {
        x.facts.secure = answer;
      });
      expect(r.guard.getSnapshot().hidden).toBe('screen_lock_off');
    },
  );

  it('EVM-101 AC1: before the first check nothing is shown ("checking")', () => {
    const r = rig();
    expect(r.guard.getSnapshot().hidden).toBe('checking');
  });
});

describe('7 days without contact (EVM-101 AC2, SR-MOB-05)', () => {
  it.each([
    [0, null, null],
    [4, null, null],
    [5, null, 2],
    [6, null, 1],
    [7, 'contact_expired', null],
  ])('EVM-101 AC2: %s days -> hidden %s, warning %s', async (days, hidden, left) => {
    const r = await started((x) => {
      x.facts.contact =
        days >= 7 ? { status: { visible: false, reason: 'window_elapsed', elapsedMs: days * DAY }, windowDays: 7 } : contactOk(days);
    });
    const s = r.guard.getSnapshot();
    expect(s.hidden).toBe(hidden);
    expect(s.warning?.daysLeft ?? null).toBe(left);
  });

  it.each(['no_contact_record', 'clock_anomaly'] as const)(
    'EVM-101 AC2: %s of sync-core hides the data (a clock set back, a restart)',
    async (reason) => {
      const r = await started((x) => {
        x.facts.contact = { status: { visible: false, reason, elapsedMs: null }, windowDays: 7 };
      });
      expect(r.guard.getSnapshot().hidden).toBe('clock_anomaly');
    },
  );

  it('EVM-101 AC2: the shorter window of the server moves the thresholds; a bad value falls back to 7', async () => {
    const r = await started((x) => {
      x.facts.contact = { status: { visible: true, elapsedMs: 1 * DAY }, windowDays: 3 };
    });
    expect(r.guard.getSnapshot().warning?.daysLeft).toBe(2);
    r.facts.contact = { status: { visible: true, elapsedMs: 2 * DAY }, windowDays: 'x' };
    await r.guard.refresh();
    expect(r.guard.getSnapshot().warning).toBeNull();
  });

  it('EVM-101 AC2: the warning disappears after a contact with the server, and the store failing hides the data', async () => {
    const r = await started((x) => {
      x.facts.contact = contactOk(6);
    });
    expect(r.guard.getSnapshot().warning?.daysLeft).toBe(1);
    r.facts.contact = contactOk(0);
    await r.guard.refresh();
    expect(r.guard.getSnapshot().warning).toBeNull();
    r.facts.contact = 'throws';
    await r.guard.refresh();
    expect(r.guard.getSnapshot().hidden).toBe('clock_anomaly');
  });

  it('EVM-101 AC2: no session (nothing to evaluate) hides nothing', async () => {
    const r = await started();
    expect(r.guard.getSnapshot().contact.kind).toBe('ok');
    r.guard.signedOut();
    expect(r.guard.getSnapshot().hidden).toBe('checking');
  });
});

describe('lock of the app (EVM-101 AC3, P7)', () => {
  it('EVM-101 AC3: after a full sign-in the app is unlocked; a restored session is locked until the system unlock', async () => {
    const r = await started();
    expect(r.guard.getSnapshot().locked).toBe(false);
    const cold = rig();
    cold.guard.start();
    expect(cold.guard.getSnapshot().locked).toBe(true);
    expect(await cold.guard.unlock()).toBe(true);
    expect(cold.guard.getSnapshot().locked).toBe(false);
  });

  it('EVM-101 AC3: less than 5 minutes in the background does not lock, more does', async () => {
    const r = await started();
    r.appState.emit('inactive');
    r.appState.emit('background');
    r.time.boot = r.time.boot + 4 * MIN;
    r.time.wall += 4 * MIN;
    r.appState.emit('active');
    expect(r.guard.getSnapshot().locked).toBe(false);
    r.appState.emit('background');
    r.time.boot = r.time.boot + 6 * MIN;
    r.time.wall += 6 * MIN;
    r.appState.emit('active');
    expect(r.guard.getSnapshot().locked).toBe(true);
  });

  it('EVM-101 AC3: cancelling or an error of the unlock keeps the lock; success opens it; the diagnostics carry the code only', async () => {
    const r = await started();
    r.appState.emit('background');
    r.time.boot = r.time.boot + 6 * MIN;
    r.appState.emit('active');
    for (const answer of ['cancelled', 'error', 'throws'] as const) {
      r.facts.auth = answer;
      expect(await r.guard.unlock()).toBe(false);
      expect(r.guard.getSnapshot().locked).toBe(true);
    }
    r.facts.auth = 'success';
    expect(await r.guard.unlock()).toBe(true);
    expect(r.guard.getSnapshot().locked).toBe(false);
    expect(r.events.filter((e) => (e as { event: string }).event === 'app-lock')).toEqual([
      { event: 'app-lock', outcome: 'cancelled' },
      { event: 'app-lock', outcome: 'error' },
      { event: 'app-lock', outcome: 'error' },
      { event: 'app-lock', outcome: 'success' },
    ]);
  });

  it('EVM-101 AC3 (loop): the AppState changes caused by the unlock window itself never lock the app again', async () => {
    const r = await started();
    r.appState.emit('background');
    r.time.boot = r.time.boot + 6 * MIN;
    r.appState.emit('active');
    expect(r.guard.getSnapshot().locked).toBe(true);
    r.facts.duringAuth = () => {
      r.appState.emit('inactive');
      r.appState.emit('background');
      r.time.boot = r.time.boot + 10 * MIN;
      r.time.wall += 10 * MIN;
      r.appState.emit('active');
    };
    expect(await r.guard.unlock()).toBe(true);
    expect(r.guard.getSnapshot().locked).toBe(false);
    expect(r.facts.authCalls).toBe(1);
    // after the window the normal rule applies again
    r.appState.emit('background');
    r.time.boot = r.time.boot + 1 * MIN;
    r.appState.emit('active');
    expect(r.guard.getSnapshot().locked).toBe(false);
  });

  it('EVM-101 AC3: unlock() while unlocked or already prompting is a no-op that never opens a second window', async () => {
    const r = await started();
    expect(await r.guard.unlock()).toBe(true);
    expect(r.facts.authCalls).toBe(0);
    r.guard.signedOut();
    const first = r.guard.unlock();
    const second = r.guard.unlock();
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(r.facts.authCalls).toBe(1);
  });
});

describe('one listener, foreground callbacks, wipe flag, patch banner (EVM-101 AC4, AC6; architect 12)', () => {
  it('EVM-101 AC3: ONE AppState listener for the whole guard, however often it starts; stop removes it', () => {
    const r = rig();
    const stop = r.guard.start();
    r.guard.start();
    expect(r.appState.listeners).toBe(1);
    stop();
    r.appState.emit('active');
    expect(r.facts.contactCalls).toBe(0);
  });

  it('EVM-101 AC3: an app that starts in the background marks the moment at once', async () => {
    const r = rig();
    r.appState.state = 'background';
    r.guard.start();
    r.guard.start();
    await r.guard.signedIn();
    r.guard.signedOut();
    r.time.boot = r.time.boot + 10 * MIN;
    r.guard.signedOut();
    expect(r.guard.getSnapshot().locked).toBe(true);
  });

  it('EVM-101 AC4: onForeground callbacks run on every return, and can be removed', async () => {
    const r = await started();
    let calls = 0;
    const off = r.guard.onForeground(() => {
      calls += 1;
    });
    r.appState.emit('background');
    r.appState.emit('active');
    off();
    r.appState.emit('background');
    r.appState.emit('active');
    expect(calls).toBe(1);
  });

  it('EVM-101 AC4: a running wipe hides the data until it ends', async () => {
    const r = await started();
    r.guard.setWiping(true);
    expect(r.guard.getSnapshot().hidden).toBe('wipe_in_progress');
    r.guard.setWiping(false);
    expect(r.guard.getSnapshot().hidden).toBeNull();
  });

  it('EVM-101 AC6: the patch banner is read once, "Rozumiem" closes it for the session, an unreadable level is logged without data', async () => {
    const r = await started((x) => {
      x.facts.patch = '2024-01-01';
    });
    expect(r.guard.getSnapshot().patch).toBe('strong');
    r.guard.dismissPatch();
    expect(r.guard.getSnapshot().patch).toBe('none');
    const u = await started((x) => {
      x.facts.patch = 'broken';
    });
    expect(u.guard.getSnapshot().patch).toBe('none');
    expect(u.events).toContainEqual({ event: 'patch-level', outcome: 'unreadable' });
  });

  it('EVM-101 AC1, AC2 (SR-LOG-08): the diagnostics name the reason only, once per change', async () => {
    const r = await started((x) => {
      x.facts.secure = false;
    });
    await r.guard.refresh();
    expect(r.events.filter((e) => (e as { event: string }).event === 'hidden-mode')).toEqual([
      { event: 'hidden-mode', reason: 'screen_lock_off' },
    ]);
  });

  it('EVM-101 AC1: subscribers are told about changes and can unsubscribe', async () => {
    const r = rig();
    let seen = 0;
    const off = r.guard.subscribe(() => {
      seen += 1;
    });
    await r.guard.signedIn();
    expect(seen).toBeGreaterThan(0);
    off();
    const before = seen;
    r.guard.setWiping(true);
    expect(seen).toBe(before);
  });
});
