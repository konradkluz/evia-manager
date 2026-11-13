/**
 * Fit of staging on a CAX11 (4 GB; decision of Konrad 2026-11-12, variant A; EVM-085 AC2). The pressure of memory is steered, not removed: ClamAV reloads its
 * signatures without holding two copies, and when the kernel has to kill something it is clamd or the processor (a scan or a preview is retried; the scan fails
 * closed), never the database or the edge. These files are installed in the IaC session; the deployment channel (compose.staging.yaml, V4) is not touched.
 */

import { describe, expect, it } from 'vitest';
import { read, record, yaml } from '../src/files.ts';

const infra = record(record(yaml('infra/runtime/compose.infra.yaml'))['services']);
const processor = record(record(record(yaml('infra/runtime/compose.media.yaml'))['services'])['media-processor']);
const staging = record(record(yaml('infra/runtime/compose.staging.yaml'))['services']);

describe('EVM-085 AC2 (CAX11 variant A): memory under control', () => {
  it('EVM-085 AC2: clamd reloads the signatures one copy at a time (ADR-0009: non-concurrent reload; the default would hold two databases in RAM)', () => {
    expect(read('infra/runtime/clamav/clamd.conf').split(/\r?\n/)).toContain('ConcurrentDatabaseReload no');
  });

  it('EVM-084: clamd and freshclam run as uid 1000 without the root entrypoint of the image, with the hardened posture kept (no capabilities, read-only root file system)', () => {
    for (const name of ['clamd', 'freshclam']) {
      const service = record(infra[name]);
      expect(service['user'], name).toBe('1000:1000');
      expect(service['read_only'], name).toBe(true);
      expect(service['cap_drop'], name).toEqual(['ALL']);
      expect('cap_add' in service, name).toBe(false);
      expect(service['entrypoint'], name).toEqual([name]);
    }
    expect(record(infra['clamd'])['command']).toContain('--config-file=/etc/evia-clamav/clamd.conf');
  });

  it('EVM-085 AC2: oom_score_adj — the database and the edge are killed last, clamd and the processor first', () => {
    expect(record(infra['postgres'])['oom_score_adj']).toBe(-500);
    expect(record(infra['caddy'])['oom_score_adj']).toBe(-500);
    expect(record(infra['clamd'])['oom_score_adj']).toBe(300);
    expect(processor['oom_score_adj']).toBe(500);
    // the scan of freshclam is short-lived and small: no preference
    expect('oom_score_adj' in record(infra['freshclam'])).toBe(false);
  });

  it('EVM-085 AC2: the deployment channel is untouched — no service of compose.staging.yaml sets oom_score_adj (V4 would refuse the key)', () => {
    for (const [name, service] of Object.entries(staging)) expect('oom_score_adj' in record(service), name).toBe(false);
  });
});
