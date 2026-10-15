import { describe, expect, it } from 'vitest';
import {
  EXIT_DRIFT,
  EXIT_OK,
  EXIT_USAGE,
  MAX_ONLY,
  executeOverviewCommand,
  parseOverviewArguments,
  type OverviewDependencies,
} from '../../src/cli/overview-run.ts';
import type { VerifyReport } from '../../src/modules/overview/index.ts';

const ID = '01a13115-0000-7000-8000-000000000001';
const OTHER = '01a13115-0000-7000-8000-000000000002';
const TRACE = 'c'.repeat(32);

describe('the arguments of the server command of the read model (EVM-034; ADR-0017 W11)', () => {
  it('EVM-034 AC6 rebuild and verify take no argument (all orders) or --only with UUIDs', () => {
    expect(parseOverviewArguments(['rebuild'])).toEqual({ ok: true, command: 'rebuild', only: undefined });
    expect(parseOverviewArguments(['verify', '--only', ID, OTHER])).toEqual({ ok: true, command: 'verify', only: [ID, OTHER] });
  });

  it.each([
    [[]],
    [['drop']],
    [['rebuild', '--all']],
    [['rebuild', '--only']],
    [['rebuild', '--only', 'not-a-uuid']],
    [['rebuild', '--only', ID, "'; select 1 --"]],
    [['verify', ID]],
  ])('EVM-034 AC6 %j is refused with the usage text (nothing is run)', (argv) => {
    expect(parseOverviewArguments(argv)).toMatchObject({ ok: false });
  });

  it('EVM-034 AC6 more than the limit of identifiers is refused', () => {
    const many = Array.from({ length: MAX_ONLY + 1 }, (_, index) => `01a13115-0000-7000-8000-${String(index).padStart(12, '0')}`);
    expect(parseOverviewArguments(['rebuild', '--only', ...many])).toMatchObject({ ok: false });
    expect(parseOverviewArguments(['rebuild', '--only', ...many.slice(0, MAX_ONLY)])).toMatchObject({ ok: true });
  });
});

function setup(report: Partial<VerifyReport> = {}) {
  const out: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const calls: unknown[] = [];
  const deps: OverviewDependencies = {
    maintenance: {
      rebuild: (options) => {
        calls.push(['rebuild', options]);
        return Promise.resolve({ rebuilt: 3, batches: 1, skipped: 0 });
      },
      verify: (options) => {
        calls.push(['verify', options]);
        return Promise.resolve({
          checked: 3,
          inSync: 3,
          missing: [],
          drift: { authorization: [], keys: [], waiting: [], deadline: [], payments: [] },
          ...report,
        });
      },
    },
    logger: { info: (fields: Record<string, unknown>) => logs.push(fields) } as unknown as OverviewDependencies['logger'],
    traceId: TRACE,
  };
  return { deps, out, logs, calls, io: { write: (text: string) => void out.push(text) } };
}

describe('the run of the server command of the read model (EVM-034 AC6; ADR-0017 W11, T7; SR-LOG-02, SR-LOG-03)', () => {
  it('EVM-034 AC6 rebuild reports numbers only, passes the named orders and logs the trace identifier with counts', async () => {
    const { deps, io, out, logs, calls } = setup();
    expect(await executeOverviewCommand(['rebuild', '--only', ID], io, deps)).toBe(EXIT_OK);
    expect(calls).toEqual([['rebuild', { only: [ID] }]]);
    expect(out.join('')).toBe('rebuild: przeliczono 3, partii 1, pominięto 0\n');
    expect(logs.every((entry) => entry['traceId'] === TRACE)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(ID);
  });

  it('EVM-034 AC6 verify of a projection in sync is exit 0; a difference lists the identifiers by group and is exit 1', async () => {
    const clean = setup();
    expect(await executeOverviewCommand(['verify'], clean.io, clean.deps)).toBe(EXIT_OK);
    expect(clean.calls).toEqual([['verify', { traceId: TRACE }]]);
    const drift = setup({ inSync: 1, drift: { authorization: [ID], keys: [], waiting: [OTHER], deadline: [], payments: [] } });
    expect(await executeOverviewCommand(['verify'], drift.io, drift.deps)).toBe(EXIT_DRIFT);
    const text = drift.out.join('');
    expect(text).toContain(`authorization ${ID}`);
    expect(text).toContain(`waiting ${OTHER}`);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(JSON.stringify(drift.logs)).not.toContain(ID);
  });

  it('EVM-034 AC6 a missing row is reported by its identifier and counts as a difference', async () => {
    const run = setup({ missing: [ID], inSync: 2 });
    expect(await executeOverviewCommand(['verify'], run.io, run.deps)).toBe(EXIT_DRIFT);
    expect(run.out.join('')).toContain(`missing ${ID}`);
  });

  it('EVM-034 AC6 a bad command writes the usage and runs nothing', async () => {
    const run = setup();
    expect(await executeOverviewCommand(['truncate'], run.io, run.deps)).toBe(EXIT_USAGE);
    expect(run.calls).toEqual([]);
    expect(run.out.join('')).toMatch(/Użycie/);
  });
});
