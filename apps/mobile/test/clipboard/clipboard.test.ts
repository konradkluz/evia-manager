import { SENSITIVE_CLIPBOARD_TTL_MS, createSensitiveClipboard } from '../../src/clipboard/clipboard';

/**
 * A fake of the native module with the contract of `EviaClipboardModule.kt`: the copy is marked sensitive, removed after the time
 * unconditionally unless another app replaced it, and `clearOwn` removes the own copy. The behaviour of the Kotlin code itself is
 * checked by hand on the emulator (journal of the story); this test fixes what the JavaScript side relies on.
 */
class FakeNative {
  clip: { text: string; sensitive: boolean; own: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private replaced = false;
  private owned = false;
  copySensitive = (text: string, ttlMs: number): boolean => {
    this.clearOwn();
    this.clip = { text, sensitive: true, own: true };
    this.owned = true;
    this.replaced = false;
    this.timer = setTimeout(this.clearOwn, ttlMs);
    return true;
  };
  clearOwn = (): void => {
    clearTimeout(this.timer);
    if (this.owned && !this.replaced) this.clip = null;
    this.owned = false;
    this.replaced = false;
  };
  otherAppCopies(text: string): void {
    this.clip = { text, sensitive: false, own: false };
    this.replaced = true;
  }
}

describe('sensitive clipboard (EVM-107 AC4)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('EVM-107 AC4: the copy is marked sensitive and the removal is asked for 60 seconds', () => {
    const native = new FakeNative();
    const spy = jest.spyOn(native, 'copySensitive');
    expect(createSensitiveClipboard(native).copy('synthetic text')).toBe(true);
    expect(spy).toHaveBeenCalledWith('synthetic text', 60_000);
    expect(SENSITIVE_CLIPBOARD_TTL_MS).toBe(60_000);
    expect(native.clip).toEqual({ text: 'synthetic text', sensitive: true, own: true });
  });

  it('EVM-107 AC4: after 60 s the copy is removed - also when the app cannot read the clipboard in the background (fail-safe)', () => {
    const native = new FakeNative();
    createSensitiveClipboard(native).copy('synthetic text');
    jest.advanceTimersByTime(59_999);
    expect(native.clip).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(native.clip).toBeNull();
  });

  it('EVM-107 AC4: a clip that another app put there meanwhile is left alone', () => {
    const native = new FakeNative();
    createSensitiveClipboard(native).copy('synthetic text');
    native.otherAppCopies('other');
    jest.advanceTimersByTime(60_000);
    expect(native.clip?.text).toBe('other');
  });

  it('EVM-107 AC4: sign-out, revoked session, wipe, hidden-data mode and lock clear the own copy at once', () => {
    const native = new FakeNative();
    const clipboard = createSensitiveClipboard(native);
    clipboard.copy('synthetic text');
    clipboard.clear();
    expect(native.clip).toBeNull();
    clipboard.clear();
    expect(native.clip).toBeNull();
  });

  it('EVM-107 AC4: a second copy replaces the first and restarts the 60 seconds', () => {
    const native = new FakeNative();
    const clipboard = createSensitiveClipboard(native);
    clipboard.copy('first');
    jest.advanceTimersByTime(40_000);
    clipboard.copy('second');
    jest.advanceTimersByTime(40_000);
    expect(native.clip?.text).toBe('second');
    jest.advanceTimersByTime(20_000);
    expect(native.clip).toBeNull();
  });

  it('EVM-107 AC4: without the native module (or with a failing one) nothing is copied and nothing throws', () => {
    expect(createSensitiveClipboard(null).copy('synthetic text')).toBe(false);
    expect(() => {
      createSensitiveClipboard(null).clear();
    }).not.toThrow();
    const broken = {
      copySensitive: (): boolean => {
        throw new Error('synthetic failure');
      },
      clearOwn: (): void => {
        throw new Error('synthetic failure');
      },
    };
    expect(createSensitiveClipboard(broken).copy('synthetic text')).toBe(false);
    expect(() => {
      createSensitiveClipboard(broken).clear();
    }).not.toThrow();
    expect(createSensitiveClipboard(new FakeNative()).copy('')).toBe(false);
  });

  it('EVM-107 AC4: the module is the only path - the Kotlin source marks the copy and declares no component', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading the source of the native module in a test
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const kotlin = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'modules',
        'evia-clipboard',
        'android',
        'src',
        'main',
        'java',
        'pl',
        'eviacharge',
        'clipboard',
        'EviaClipboardModule.kt',
      ),
      'utf8',
    );
    expect(kotlin).toContain('EXTRA_IS_SENSITIVE');
    expect(kotlin).toContain('android.content.extra.IS_SENSITIVE');
    expect(kotlin).toContain('OnPrimaryClipChangedListener');
    expect(kotlin).toContain('postDelayed');
    expect(kotlin).not.toMatch(/\bLog\.|println|: Service\(|BroadcastReceiver|ContentProvider/);
  });
});
