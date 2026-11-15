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
    expect(await session.lastContact()).toBeNull();
    expect(() => {
      session.addListener('onSessionState', () => undefined).remove();
    }).not.toThrow();
  });

  it('EVM-130 AC4: without the module the files wait — nothing is armed, nothing is deleted, the wipe has nothing to remove', async () => {
    const upload = nativeUploadOf(null);
    expect(upload).toBe(UNAVAILABLE_UPLOAD);
    expect(await upload.digestOriginal('a')).toBeNull();
    expect(await upload.reconcile([], false)).toEqual({});
    expect(await upload.retryUpload('a', false)).toBe('unavailable');
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
});
