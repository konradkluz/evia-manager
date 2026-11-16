import type { EviaUploadModule } from '../../modules/evia-upload/src';
import { nativeSessionOf, UNAVAILABLE_SESSION } from '../../src/auth/native-session';
import { nativeUploadOf, UNAVAILABLE_UPLOAD } from '../../src/upload/native-upload';

describe('without the native module (EVM-130 AC3; fail closed)', () => {
  it('EVM-130 AC3: every call of the session answers "unavailable" — no sign-in is possible, JavaScript never keeps a token itself', async () => {
    const session = nativeSessionOf(null);
    expect(session).toBe(UNAVAILABLE_SESSION);
    expect(await session.stageLogin('u', 'd', 'r', 'a', 1, null)).toBe('unavailable');
    expect(await session.commitStaged(false)).toBe('unavailable');
    expect(await session.abandonStaged()).toBe('unavailable');
    expect(await session.accessToken(null)).toEqual({ status: 'unavailable' });
    expect(await session.sessionState()).toEqual({ state: 'unavailable', ownerId: null });
    for (const answer of [
      await session.reportApiRevoked(),
      await session.reportDeviceWipeRequired(),
      await session.reportUpdateRequired(),
      await session.signOut(true),
      await session.flushPendingRevocations(),
      await session.clearWipeMarkerAfterLogin(),
    ]) {
      expect(answer).toBe(false);
    }
    // no module, no camera cache of this app: nothing to clean, so nothing is reported as unfinished (EVM-108 pkt 13)
    expect(await session.clearCaptureCache()).toBe(true);
    expect(await session.lastContact()).toBeNull();
    expect(() => {
      session.addListener('onSessionState', () => undefined).remove();
    }).not.toThrow();
  });

  it('EVM-130 AC4: without the module the files wait — nothing is armed, nothing is deleted, the wipe has nothing to remove', async () => {
    const upload = nativeUploadOf(null);
    expect(upload).toBe(UNAVAILABLE_UPLOAD);
    expect(await upload.digestOriginal('a')).toBeNull();
    expect(await upload.importOriginal('a', 'file:///x', 'photo')).toBe('unavailable');
    expect(await upload.sweepOriginals(['a'], 1)).toBe(0);
    expect(await upload.cancelUpload('a', true)).toBe(false);
    expect(await upload.reconcile([])).toEqual({});
    expect(await upload.retryUpload('a')).toBe('unavailable');
    // EVM-110 AC4: without the module the setting reads its default (on, fail closed) and cannot be stored
    expect(upload.getVideoWifiOnly()).toBe(true);
    expect(await upload.setVideoWifiOnly(false)).toBe(false);
    expect(await upload.completeUpload('a', 'ready', null)).toBe('unavailable');
    expect(await upload.uploadStatuses()).toEqual([]);
    expect(await upload.wipeUploads()).toBe(true);
    expect(upload.notificationPermission()).toBe('granted');
    expect(await upload.requestNotificationPermission()).toBe('denied');
    expect(await upload.openNotificationSettings()).toBe(false);
    expect(upload.launchTarget()).toBeNull();
    expect(await upload.e2eInjectFile('a', 1, 1)).toBeNull();
    expect(() => {
      upload.addListener('onFileState', () => undefined).remove();
    }).not.toThrow();
  });

  it('EVM-130 AC3: a module that exists is used as it is', () => {
    const module = { marker: true } as never;
    expect(nativeSessionOf(module)).toBe(module);
    expect(nativeUploadOf(module)).toBe(module);
  });

  it('EVM-130 AC2: a module of a build without storage hosts keeps the session working - only the sending answers "upload_unavailable", nothing throws', async () => {
    const module = {
      stageLogin: () => Promise.resolve('ok'),
      commitStaged: () => Promise.resolve('ok'),
      accessToken: () => Promise.resolve({ status: 'ready', accessToken: 'a', ownerId: 'u:d', validForMs: 1000 }),
      sessionState: () => Promise.resolve({ state: 'signed_in', ownerId: 'u:d' }),
      armUpload: () => Promise.resolve('upload_unavailable'),
      reconcile: (items: readonly { assetId: string }[]) =>
        Promise.resolve(Object.fromEntries(items.map((item) => [item.assetId, 'upload_unavailable']))),
      retryUpload: () => Promise.resolve('upload_unavailable'),
      uploadStatuses: () => Promise.resolve([]),
    } as never as EviaUploadModule;
    const session = nativeSessionOf(module);
    expect(await session.stageLogin('u', 'd', 'r', 'a', 1000, null)).toBe('ok');
    expect(await session.commitStaged(false)).toBe('ok');
    expect(await session.accessToken(null)).toMatchObject({ status: 'ready' });
    expect(await session.sessionState()).toEqual({ state: 'signed_in', ownerId: 'u:d' });
    const upload = nativeUploadOf(module);
    const item = { assetId: 'a', workOrderId: 'w', userId: 'u', deviceId: 'd', contentType: 'image/jpeg' };
    expect(await upload.reconcile([item])).toEqual({ a: 'upload_unavailable' });
    expect(await upload.retryUpload('a')).toBe('upload_unavailable');
    expect(await upload.uploadStatuses()).toEqual([]);
  });
});
