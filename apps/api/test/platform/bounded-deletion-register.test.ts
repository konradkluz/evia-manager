import { describe, expect, it } from 'vitest';
import { BoundedDeletionRegister } from '../../src/platform/deletion-register/bounded-deletion-register.ts';
import {
  DeletionRegisterUnavailable,
  type DeletionReceipt,
  type DeletionRecord,
  type DeletionRegister,
} from '../../src/platform/deletion-register/deletion-register.ts';
import { REGISTER_FAILURES_METRIC } from '../../src/platform/deletion-register/deletion-register-factory.ts';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';

const record: DeletionRecord = {
  operationCode: 'timeline_entry_redacted',
  subjectType: 'timeline_entry',
  subjectId: '0199aaaa-0000-7000-8000-000000000001',
  workOrderId: '0199aaaa-0000-7000-8000-000000000002',
  actorUserId: '0199aaaa-0000-7000-8000-000000000003',
};
const receipt: DeletionReceipt = { operationId: 'op', key: '2026/op.json' };

/** An inner register that holds every call until released, and counts how many run at once. */
class HeldRegister implements DeletionRegister {
  running = 0;
  peak = 0;
  started = 0;
  readonly #releases: Array<() => void> = [];

  async record(): Promise<DeletionReceipt> {
    this.running += 1;
    this.started += 1;
    this.peak = Math.max(this.peak, this.running);
    await new Promise<void>((resolve) => this.#releases.push(resolve));
    this.running -= 1;
    return receipt;
  }

  releaseAll(): void {
    for (const release of this.#releases.splice(0)) release();
  }
}

const counter = () => new MetricsRegistry().counter(REGISTER_FAILURES_METRIC, ['reason']);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('the writes to the register of deletions are bounded (EVM-040 AC3; CWE-400, RR-NOC-T2-4)', () => {
  it('EVM-040 AC3 at most the limit of writes run at once and the rest waits for a place', async () => {
    const inner = new HeldRegister();
    const bounded = new BoundedDeletionRegister(inner, { limit: 2, waitMs: 1000 }, counter());
    const calls = [1, 2, 3, 4].map(() => bounded.record(record));
    await tick();
    expect(inner.started).toBe(2);
    inner.releaseAll();
    await tick();
    expect(inner.started).toBe(4);
    inner.releaseAll();
    await expect(Promise.all(calls)).resolves.toHaveLength(4);
    expect(inner.peak).toBe(2);
  });

  it('EVM-040 AC3 a write that waits longer than the limit of waiting is refused as unavailable, without calling the register, and is counted', async () => {
    const inner = new HeldRegister();
    const metrics = new MetricsRegistry();
    const bounded = new BoundedDeletionRegister(inner, { limit: 1, waitMs: 20 }, metrics.counter(REGISTER_FAILURES_METRIC, ['reason']));
    const first = bounded.record(record);
    await tick();
    await expect(bounded.record(record)).rejects.toMatchObject({ name: 'DeletionRegisterUnavailable', reason: 'busy' });
    expect(inner.started).toBe(1);
    inner.releaseAll();
    await first;
    expect(metrics.snapshot()).toEqual([{ name: REGISTER_FAILURES_METRIC, labels: { reason: 'busy' }, value: 1 }]);
  });

  it('EVM-040 AC3 a failed write gives its place back, so the next one is served', async () => {
    const failing: DeletionRegister = {
      record: () => Promise.reject(new DeletionRegisterUnavailable('write_failed')),
    };
    const bounded = new BoundedDeletionRegister(failing, { limit: 1, waitMs: 20 }, counter());
    await expect(bounded.record(record)).rejects.toMatchObject({ reason: 'write_failed' });
    await expect(bounded.record(record)).rejects.toMatchObject({ reason: 'write_failed' });
  });
});
