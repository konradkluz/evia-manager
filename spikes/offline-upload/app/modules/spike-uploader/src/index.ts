import { requireNativeModule } from 'expo';

export interface NativeJob {
  assetId: string;
  state: 'queued' | 'uploading' | 'uploaded' | 'paused_revoked' | 'failed';
  size: number;
  bytesDone: number;
  partCount: number;
  partsDone: number;
  retries: number;
  renewals: number;
  partPuts: number;
  skippedParts: number;
  stops: number;
  runs: number;
  startedAt: number;
  finishedAt: number;
  sha256: string;
  pending: boolean;
  lastError: string;
}

export type LaunchCommand = { cmd: string; path?: string; type?: string; asset?: string; sha?: string; flag?: string };

interface SpikeUploaderNative {
  getLaunchCommand(): LaunchCommand | null;
  hasConfig(): boolean;
  deviceInfo(): { sdk: number; release: string; model: string; patch: string };
  freeBytes(): Promise<number>;
  moveToSandbox(src: string): Promise<{ path: string; size: number }>;
  sha256File(path: string): Promise<string>;
  registerJob(assetId: string, path: string, sha256: string, contentType: string, killAfterComplete: boolean): Promise<number>;
  scheduleUpload(assetId: string): Promise<string>;
  ensureScheduled(): Promise<number>;
  getJobs(): Promise<NativeJob[]>;
  confirmAndDelete(assetId: string, remoteSha256: string): Promise<boolean>;
  addListener(event: 'onCommand', listener: (c: LaunchCommand) => void): { remove(): void };
}

export default requireNativeModule<SpikeUploaderNative>('SpikeUploader');
