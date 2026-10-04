// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeCoverage, parseLcov } from '../lib/lcov.mjs';

const REPORT = [
  'TN:',
  'SF:src\\a.ts',
  'DA:1,1',
  'DA:2,0',
  'BRDA:2,0,0,1',
  'BRDA:2,0,1,-',
  'BRDA:3,1,0,0',
  'end_of_record',
  'SF:/abs/b.mjs',
  'DA:5,3',
  'end_of_record',
  '',
].join('\n');

describe('lcov (EVM-006 AC3)', () => {
  it('EVM-006 AC3: parses line hits and branches per source file', () => {
    const records = parseLcov(REPORT);
    assert.deepEqual(
      records.map((r) => r.source),
      ['src\\a.ts', '/abs/b.mjs'],
    );
    const [a] = records;
    assert.ok(a);
    assert.deepEqual(
      [...a.lines],
      [
        [1, 1],
        [2, 0],
      ],
    );
    assert.deepEqual(
      [...a.branches],
      [
        ['2:0:0', 1],
        ['2:0:1', 0],
        ['3:1:0', 0],
      ],
    );
  });

  it('EVM-006 AC3: tolerates CRLF, blank lines and unknown records; a record without SF is ignored', () => {
    const records = parseLcov('TN:\r\nDA:1,1\r\nend_of_record\r\nSF:x.ts\r\nFN:1,f\r\nDA:2,4\r\nend_of_record\r\n');
    assert.equal(records.length, 1);
    assert.deepEqual([...(records[0]?.lines ?? [])], [[2, 4]]);
  });

  it('EVM-006 AC3: merges reports of the same file (host, container, CI) by the maximum hit count', () => {
    const merged = mergeCoverage([
      {
        file: 'p/a.ts',
        lines: new Map([
          [1, 0],
          [2, 1],
        ]),
        branches: new Map([['2:0:0', 0]]),
      },
      {
        file: 'p/a.ts',
        lines: new Map([
          [1, 2],
          [3, 0],
        ]),
        branches: new Map([
          ['2:0:0', 5],
          ['2:0:1', 0],
        ]),
      },
      { file: 'p/b.ts', lines: new Map([[9, 1]]), branches: new Map() },
    ]);
    assert.deepEqual(
      [...(merged.get('p/a.ts')?.lines ?? [])].sort(([x], [y]) => x - y),
      [
        [1, 2],
        [2, 1],
        [3, 0],
      ],
    );
    assert.deepEqual(
      [...(merged.get('p/a.ts')?.branches ?? [])],
      [
        ['2:0:0', 5],
        ['2:0:1', 0],
      ],
    );
    assert.deepEqual([...(merged.get('p/b.ts')?.lines ?? [])], [[9, 1]]);
  });
});
