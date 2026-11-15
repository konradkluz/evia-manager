/**
 * The native module as the queue of files sees it (EVM-130): arming after `applied`, the status, the verdict about the original,
 * the cleaning and the notification consent. No function takes or returns the bytes of a file or a token.
 */
import type { EviaUploadModule } from '../../modules/evia-upload/src';

export type NativeUpload = Pick<
  EviaUploadModule,
  | 'digestOriginal'
  | 'importOriginal'
  | 'sweepOriginals'
  | 'cancelUpload'
  | 'reconcile'
  | 'retryUpload'
  | 'setKeepScreenOn'
  | 'getVideoWifiOnly'
  | 'setVideoWifiOnly'
  | 'completeUpload'
  | 'uploadStatuses'
  | 'wipeUploads'
  | 'notificationPermission'
  | 'requestNotificationPermission'
  | 'openNotificationSettings'
  | 'launchTarget'
  | 'e2eInjectFile'
  | 'addListener'
>;

/** Without the module (Jest, a platform without it) there is nothing to upload with: the files wait, nothing is lost. */
export const UNAVAILABLE_UPLOAD: NativeUpload = {
  digestOriginal: () => Promise.resolve(null),
  importOriginal: () => Promise.resolve('unavailable'),
  sweepOriginals: () => Promise.resolve(0),
  cancelUpload: () => Promise.resolve(false),
  reconcile: () => Promise.resolve({}),
  retryUpload: () => Promise.resolve('unavailable'),
  setKeepScreenOn: () => false,
  getVideoWifiOnly: () => true,
  setVideoWifiOnly: () => Promise.resolve(false),
  completeUpload: () => Promise.resolve('unavailable'),
  uploadStatuses: () => Promise.resolve([]),
  wipeUploads: () => Promise.resolve(true),
  notificationPermission: () => 'granted',
  requestNotificationPermission: () => Promise.resolve('denied'),
  openNotificationSettings: () => Promise.resolve(false),
  launchTarget: () => null,
  e2eInjectFile: () => Promise.resolve(null),
  addListener: () => ({ remove: (): void => undefined }),
};

export const nativeUploadOf = (module: EviaUploadModule | null): NativeUpload => module ?? UNAVAILABLE_UPLOAD;
