import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { E2eHooks as Slot } from '../src/e2e-hooks';
import { E2E_HOOKS_MARKER, E2E_USERS, E2eHooks, sentinel, statusLine, syntheticRecord, type E2eHooksDeps } from '../src/e2e-hooks/panel';
import { WIPE_MARKER_FILE, wipeFaultForE2e, type OpenResult } from '../src/storage/local-data';
import { boot, newDevice, type Device } from './storage/fakes';
import { NodeSqliteEngine, newDisk, removeDisk, type TestDisk } from './storage/node-sqlite-engine';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  renders = 0;
  disk = newDisk();
  device = newDevice(disk);
  wipeFaultForE2e.afterStep = null;
});
afterEach(() => {
  removeDisk(disk);
});

function depsOf(): E2eHooksDeps {
  let clock = 1000;
  return {
    host: boot(device).host,
    deleteDatabaseKey: () => {
      device.key = null;
      return Promise.resolve();
    },
    wipeFault: wipeFaultForE2e,
    copyEngine: () => new NodeSqliteEngine(disk, 'evia-copy.db'),
    now: () => (clock += 100),
  };
}

/** The real host of `deps` whose `openForUser` answers a fixed outcome. */
const answering = (deps: E2eHooksDeps, outcome: OpenResult): E2eHooksDeps['host'] => ({
  openForUser: () => Promise.resolve(outcome),
  facts: () => deps.host.facts(),
  probe: (engine) => deps.host.probe(engine),
  wipeCompanyData: () => deps.host.wipeCompanyData(),
});

async function tap(id: string): Promise<void> {
  await act(async () => {
    await fireEvent.press(screen.getByTestId(id));
    await Promise.resolve();
  });
  // the actions run on the node:sqlite engine, which yields to the event loop on every statement
  await waitFor(
    () => {
      const line = screen.queryByTestId('e2e-status');
      if (line !== null) expect(String(line.props.children)).not.toBe('busy=yes');
    },
    { timeout: 10_000 },
  );
}

async function type(id: string, value: string): Promise<void> {
  await act(async () => {
    await fireEvent.changeText(screen.getByTestId(id), value);
    await Promise.resolve();
  });
}

async function expectStatus(value: string): Promise<void> {
  await waitFor(
    () => {
      expect(status()).toBe(value);
    },
    { timeout: 10_000 },
  );
}

const status = (): string => String(screen.getByTestId('e2e-status').props.children);

let renders = 0;
/** Renders the panel (a new process: a new component with its own deps) and opens it. */
async function opened(deps: E2eHooksDeps = depsOf()): Promise<E2eHooksDeps> {
  renders += 1;
  const element = inProvider(<E2eHooks key={renders} deps={deps} />);
  if (renders === 1) await render(element);
  else
    await act(async () => {
      await screen.rerender(element);
      await Promise.resolve();
    });
  await tap(E2E_HOOKS_MARKER);
  return deps;
}

describe('e2e hooks of the local store (EVM-093 AC1, AC3, AC5–AC7)', () => {
  it('EVM-093 AC1: the slot bundled outside the e2e variant renders nothing', async () => {
    await render(<Slot />);
    expect(screen.queryByTestId(E2E_HOOKS_MARKER)).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('EVM-093 AC1: the panel is hidden behind one 48 dp toggle carrying the marker; the status shows codes and numbers only', async () => {
    await render(inProvider(<E2eHooks deps={depsOf()} />));
    expect(screen.queryByTestId('e2e-status')).toBeNull();
    await tap(E2E_HOOKS_MARKER);
    await expectStatus('open=none');
    await tap('e2e-close');
    expect(screen.getByTestId(E2E_HOOKS_MARKER)).toBeOnTheScreen();
  });

  it('EVM-093 AC1, AC3: user A signs in, appends entries carrying the sentinel; the count is shown after every append resolved', async () => {
    await opened();
    await tap('e2e-login-a');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
    await type('e2e-count', '19');
    await tap('e2e-append');
    await expectStatus('open=unlocked;appended=19;queue=19');
    await type('e2e-count', 'x');
    await tap('e2e-append');
    await expectStatus('open=unlocked;appended=1;queue=20');
    await tap('e2e-facts');
    await expectStatus('open=yes;cipher_version=4.17.0 community;temp_store=2;queue=20');
    expect(status()).not.toContain(sentinel());
  });

  it('EVM-093 AC7: A keeps 5 entries; B is refused with the number only; after the wipe B starts empty as a new device', async () => {
    await opened();
    await tap('e2e-login-a');
    await type('e2e-count', '5');
    await tap('e2e-append');
    await tap('e2e-end-session');
    await expectStatus('open=locked');
    await tap('e2e-login-b');
    await expectStatus('open=owner_mismatch;queue=5');
    await tap('e2e-append');
    await expectStatus('error=locked');
    await tap('e2e-wipe');
    await expectStatus('wipe=done');
    await tap('e2e-login-b');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
    // A signs in after B: the queue belongs to B now
    await tap('e2e-end-session');
    await tap('e2e-login-a');
    await expectStatus('open=owner_mismatch;queue=0');
  });

  it('EVM-093 AC7: after the end of a session the same user finds the queue and the installation identity kept', async () => {
    await opened();
    await tap('e2e-login-a');
    await type('e2e-count', '5');
    await tap('e2e-append');
    await tap('e2e-end-session');
    await tap('e2e-login-a');
    await expectStatus('open=unlocked;queue=5;identity=kept;pull=no');
    expect(E2E_USERS).toEqual({ a: 'e2e-user-a', b: 'e2e-user-b' });
  });

  it('EVM-093 AC5: a deleted key gives the blocking message after sign-in; "Rozumiem" creates a new database for a new device', async () => {
    const deps = depsOf();
    await opened(deps);
    await tap('e2e-login-a');
    await type('e2e-count', '3');
    await tap('e2e-append');
    await tap('e2e-delete-key');
    await expectStatus('key=deleted');
    // a new process: the native handles are closed, a new host runs on the same device
    for (const handle of disk.handles) if (handle.isOpen) handle.close();
    await opened({ ...deps, host: boot(device).host });
    await tap('e2e-login-a');
    expect(screen.getByTestId('local-data-lost')).toBeOnTheScreen();
    await tap('local-data-lost-ack');
    await expectStatus('open=unlocked;queue=0;identity=new;pull=first');
  });

  it('EVM-093 AC6: the wipe fault leaves the wipe incomplete with the marker; a copy taken before the wipe does not open', async () => {
    const deps = await opened();
    await tap('e2e-login-a');
    await tap('e2e-append');
    new NodeSqliteEngine(disk).copyTo(new NodeSqliteEngine(disk, 'evia-copy.db'));
    await type('e2e-wipe-fault', ' database_file ');
    await tap('e2e-wipe');
    await expectStatus('wipe=incomplete');
    expect(device.files.has(WIPE_MARKER_FILE)).toBe(true);
    expect(deps.wipeFault.afterStep).toBeNull();
    await type('e2e-wipe-fault', '');
    await tap('e2e-wipe');
    await expectStatus('wipe=done');
    await tap('e2e-login-b');
    await tap('e2e-probe');
    await expectStatus('probe=not_a_database');
  });

  it('EVM-093 AC5: a failing action shows a fixed code, never the error text', async () => {
    await opened({ ...depsOf(), deleteDatabaseKey: () => Promise.reject(new Error('secret detail /data/x')) });
    await tap('e2e-delete-key');
    await expectStatus('error=action_failed');
  });

  it('EVM-093 AC1: other outcomes of opening are shown by their kind and code', async () => {
    const deps = depsOf();
    await opened({ ...deps, host: answering(deps, { kind: 'unavailable', code: 'busy' }) });
    await tap('e2e-login-a');
    await expectStatus('open=unavailable;reason=busy');
    await opened({ ...deps, host: answering(deps, { kind: 'update_required' }) });
    await tap('e2e-login-a');
    await expectStatus('open=update_required');
    await tap('e2e-facts');
    await expectStatus('open=no;cipher_version=none;temp_store=none;queue=locked');
  });

  it('EVM-093 AC1: synthetic records belong to the given user and carry the sentinel in the payload only', () => {
    const record = syntheticRecord(E2E_USERS.a, 7);
    expect(record.ownerUserId).toBe('e2e-user-a');
    expect(JSON.stringify(record.payload)).toContain('EVM093-SENTINEL');
    expect(record.mutationId).not.toBe(syntheticRecord(E2E_USERS.a, 8).mutationId);
    expect(statusLine({ a: 1, b: 'x' })).toBe('a=1;b=x');
  });
});
