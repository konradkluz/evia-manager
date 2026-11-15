// A fake of the files of the queue seen by the screens (EVM-130): a settable snapshot, recorded calls.
import type { MediaControl, MediaUploadsSnapshot } from '../../src/upload/types';

export class FakeMedia implements MediaControl {
  snapshot: MediaUploadsSnapshot = { files: [], notifications: 'granted' };
  launchTarget: 'queue' | null = null;
  retryResult = true;
  consent: 'granted' | 'denied' = 'granted';
  readonly calls: string[] = [];
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): MediaUploadsSnapshot => this.snapshot;

  /** Replaces the snapshot and tells the screens. */
  set(snapshot: MediaUploadsSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.#listeners]) listener();
  }

  retry(assetId: string): Promise<boolean> {
    this.calls.push(`retry:${assetId}`);
    return Promise.resolve(this.retryResult);
  }

  requestNotifications(): Promise<'granted' | 'denied'> {
    this.calls.push('requestNotifications');
    return Promise.resolve(this.consent);
  }

  openNotificationSettings(): Promise<boolean> {
    this.calls.push('openNotificationSettings');
    return Promise.resolve(true);
  }

  consumeLaunchTarget(): 'queue' | null {
    this.calls.push('consumeLaunchTarget');
    const target = this.launchTarget;
    this.launchTarget = null;
    return target;
  }

  refresh(): Promise<void> {
    this.calls.push('refresh');
    return Promise.resolve();
  }
}
