import { describe, expect, it } from 'vitest';
import type { FileState } from '../../src/modules/media/domain/scan-outcome.ts';
import { syncFileStatus } from '../../src/modules/media/domain/sync-state.ts';

const ALL: readonly FileState[] = ['pending_upload', 'uploaded', 'scanning', 'clean', 'processing', 'ready', 'quarantined', 'failed'];

describe('the state of the file of a medium for the phone (EVM-131 AC4; SR-MOB-10, SR-FILE-05)', () => {
  it('EVM-131 AC4 a medium without a file is pending; every state of the file has the state the phone knows', () => {
    expect(syncFileStatus(null, null)).toEqual({ fileState: 'pending', fileStateReasonCode: null });
    expect(syncFileStatus('pending_upload', null).fileState).toBe('pending');
    expect(syncFileStatus('uploaded', null).fileState).toBe('uploading');
    expect(syncFileStatus('scanning', null).fileState).toBe('uploading');
    expect(syncFileStatus('clean', null).fileState).toBe('clean');
    expect(syncFileStatus('processing', null).fileState).toBe('processing');
    expect(syncFileStatus('ready', null).fileState).toBe('ready');
    expect(syncFileStatus('quarantined', 'malware_detected').fileState).toBe('quarantined');
    expect(syncFileStatus('failed', 'checksum_mismatch').fileState).toBe('failed');
  });

  it('EVM-131 AC4 the invariant: the phone sees `clean` ONLY for the state the server gives after the scan agreed - every state before it (also uploaded and scanning) is `uploading`', () => {
    const clean = ALL.filter((state) => syncFileStatus(state, null).fileState === 'clean');
    expect(clean).toEqual(['clean']);
    for (const state of ['pending_upload', 'uploaded', 'scanning', 'quarantined', 'failed'] as const) {
      const reason = state === 'quarantined' || state === 'failed' ? 'processing_error' : null;
      expect(syncFileStatus(state, reason).fileState, state).not.toBe('clean');
    }
  });

  it('EVM-131 AC4 the reason is an allow-list: a failure keeps checksum_mismatch, processing_error and abandoned; every other reason - also those of a quarantine - is null', () => {
    for (const reason of ['checksum_mismatch', 'processing_error', 'abandoned']) {
      expect(syncFileStatus('failed', reason)).toEqual({ fileState: 'failed', fileStateReasonCode: reason });
    }
    for (const reason of ['malware_detected', 'type_mismatch', 'anything', '']) {
      expect(syncFileStatus('failed', reason).fileStateReasonCode, reason).toBeNull();
      expect(syncFileStatus('quarantined', reason).fileStateReasonCode, reason).toBeNull();
    }
    for (const state of ALL.filter((state) => state !== 'failed')) {
      expect(syncFileStatus(state, 'checksum_mismatch').fileStateReasonCode, state).toBeNull();
    }
    expect(syncFileStatus('failed', null).fileStateReasonCode).toBeNull();
  });
});
