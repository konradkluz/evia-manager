import { logDiagnostic } from '../../src/logging/log';
import { proofFields } from '../../src/storage/installation-proof';
import { WIPE_MARKER_FILE } from '../../src/storage/local-data';
import { boot, newDevice, type Device } from './fakes';
import { newDisk, removeDisk, type TestDisk } from './node-sqlite-engine';

let disk: TestDisk;
let device: Device;
beforeEach(() => {
  disk = newDisk();
  device = newDevice(disk);
  device.identity = { deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' };
  device.refreshToken = 'refresh-synthetic';
  device.otherSecrets = true;
});
afterEach(() => {
  removeDisk(disk);
});

describe('confirmation of a server-ordered wipe (EVM-101 AC4; architect 1, security W2)', () => {
  it('EVM-101 AC4: the pair is copied to its own slot BEFORE the marker and the steps; the wipe leaves only that slot', async () => {
    const { host } = boot(device);
    expect(await host.wipeCompanyData({ confirmToServer: true })).toBe('done');
    expect(device.identity).toBeNull();
    expect(device.refreshToken).toBeNull();
    expect(device.otherSecrets).toBe(false);
    expect(device.wipeConfirmation).toEqual({ deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' });
    const log = device.log;
    expect(log.indexOf('secrets.writeWipeConfirmation')).toBeLessThan(log.indexOf(`files.write:${WIPE_MARKER_FILE}`));
    expect(log.indexOf('secrets.writeWipeConfirmation')).toBeLessThan(log.indexOf('secrets.deleteIdentity'));
  });

  it('EVM-101 AC4: the manual wipe keeps no slot (no confirmation is owed)', async () => {
    const { host } = boot(device);
    expect(await host.wipeCompanyData()).toBe('done');
    expect(device.wipeConfirmation).toBeNull();
    expect(await host.pendingWipeConfirmation()).toBeNull();
  });

  it('EVM-101 AC4: the pair comes back as an opaque proof for the HTTP adapter; clearing removes the slot', async () => {
    const { host } = boot(device);
    await host.wipeCompanyData({ confirmToServer: true });
    const proof = await host.pendingWipeConfirmation();
    expect(proof).not.toBeNull();
    expect(JSON.stringify(proof)).not.toContain('secret-synthetic-a');
    expect(String(proof)).not.toContain('device-synthetic-a');
    expect(proofFields(proof as NonNullable<typeof proof>)).toEqual({
      deviceId: 'device-synthetic-a',
      installationSecret: 'secret-synthetic-a',
    });
    await host.clearWipeConfirmation();
    expect(device.wipeConfirmation).toBeNull();
    expect(await host.pendingWipeConfirmation()).toBeNull();
  });

  it.each(['secrets.deleteIdentity', 'secrets.deleteAllSecrets', 'secrets.deletePreferences', `files.remove:${WIPE_MARKER_FILE}`])(
    'EVM-101 AC4: the process killed after %s - the next start finishes the wipe and the pair is still owed',
    async (point) => {
      const first = boot(device);
      device.fail.set(point, { after: true, sticky: false });
      expect(await first.host.wipeCompanyData({ confirmToServer: true })).toBe('incomplete');
      const second = boot(device);
      expect(await second.host.prepare()).toBe('ready');
      expect(device.identity).toBeNull();
      expect(device.files.has(WIPE_MARKER_FILE)).toBe(false);
      expect(device.wipeConfirmation).toEqual({ deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' });
      expect(proofFields((await second.host.pendingWipeConfirmation()) as never)?.deviceId).toBe('device-synthetic-a');
    },
  );

  it('EVM-101 AC4: a repeated device_wipe_required after the identity is gone keeps the slot (idempotent, no overwrite with nothing)', async () => {
    const { host } = boot(device);
    await host.wipeCompanyData({ confirmToServer: true });
    await host.wipeCompanyData({ confirmToServer: true });
    expect(device.wipeConfirmation).toEqual({ deviceId: 'device-synthetic-a', secret: 'secret-synthetic-a' });
  });

  it('EVM-101 AC4: a slot that cannot be written never blocks the wipe (the server ends the tokens without the confirmation)', async () => {
    const { host, diagnostics } = boot(device);
    device.fail.set('secrets.writeWipeConfirmation', { after: false, sticky: false });
    expect(await host.wipeCompanyData({ confirmToServer: true })).toBe('done');
    expect(device.wipeConfirmation).toBeNull();
    expect(diagnostics).toContainEqual({ event: 'wipe-step-failed', step: 'confirmation_slot' });
  });

  it('EVM-101 AC4: a device without an identity owes nothing', async () => {
    device.identity = null;
    const { host } = boot(device);
    await host.wipeCompanyData({ confirmToServer: true });
    expect(device.wipeConfirmation).toBeNull();
  });

  it('EVM-101 AC4: after the wipe the next sign-in registers a NEW device - the old pair is never mixed into the identity', async () => {
    const { host } = boot(device);
    await host.wipeCompanyData({ confirmToServer: true });
    expect(await host.installationProof()).toBeNull();
  });

  it('EVM-101 AC4: the slot is never read as the identity of the sign-in and holds no personal data (only the pair)', async () => {
    const { host } = boot(device);
    await host.wipeCompanyData({ confirmToServer: true });
    expect(Object.keys(device.wipeConfirmation ?? {}).sort()).toEqual(['deviceId', 'secret']);
  });

  it('EVM-101 AC4 (SR-LOG-08): the diagnostics of the confirmation print a fixed name and an outcome code', () => {
    const lines: string[] = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    logDiagnostic({ event: 'wipe-confirmation', outcome: 'sent' });
    logDiagnostic({ event: 'wipe-confirmation', outcome: 'secret-synthetic-a' as 'sent' });
    logDiagnostic({ event: 'hidden-mode', reason: 'screen_lock_off' });
    logDiagnostic({ event: 'app-lock', outcome: 'cancelled' });
    logDiagnostic({ event: 'patch-level', outcome: 'unreadable' });
    warn.mockRestore();
    expect(lines).toEqual([
      '[evia] wipe-confirmation sent',
      '[evia] wipe-confirmation invalid',
      '[evia] hidden-mode screen_lock_off',
      '[evia] app-lock cancelled',
      '[evia] patch-level unreadable',
    ]);
  });
});
