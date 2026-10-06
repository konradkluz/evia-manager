import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';

describe('metrics registry (EVM-067; SR-LOG-06, SR-LOG-02)', () => {
  it('EVM-067 AC2 a counter counts per label value and the snapshot lists every sample', () => {
    const registry = new MetricsRegistry();
    const failures = registry.counter('evia_login_failures_total', ['reason']);
    failures.increment({ reason: 'bad_password' });
    failures.increment({ reason: 'bad_password' });
    failures.increment({ reason: 'unknown_user' });
    expect(registry.snapshot()).toEqual([
      { name: 'evia_login_failures_total', labels: { reason: 'bad_password' }, value: 2 },
      { name: 'evia_login_failures_total', labels: { reason: 'unknown_user' }, value: 1 },
    ]);
    expect(registry.counter('evia_login_failures_total', ['reason'])).toBeDefined();
    expect(new MetricsRegistry().snapshot()).toEqual([]);
  });

  it('EVM-067 AC2 only the declared labels are accepted, and only as short codes — an address, an e-mail or an identifier cannot become a label value', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('evia_things_total', ['reason']);
    for (const labels of [{}, { reason: 'x', ip: 'y' }, { other: 'x' }] as Array<Record<string, string>>) {
      expect(() => {
        counter.increment(labels);
      }, JSON.stringify(labels)).toThrow(/labels/);
    }
    for (const value of ['jan@evia.invalid', '203.0.113.7', '0190a1b2-0000-7000-8000-00000000a001', 'Bad Password', '', 'a'.repeat(33)]) {
      expect(() => {
        counter.increment({ reason: value });
      }, value).toThrow(/short code/);
    }
    expect(registry.snapshot()).toEqual([]);
  });

  it('EVM-067 AC2 a name must be a plain identifier and a counter cannot be registered again with other labels', () => {
    const registry = new MetricsRegistry();
    expect(() => registry.counter('Bad Name', ['reason'])).toThrow(/name/);
    registry.counter('evia_x_total', ['reason']);
    expect(() => registry.counter('evia_x_total', ['kind'])).toThrow(/other labels/);
  });
});
