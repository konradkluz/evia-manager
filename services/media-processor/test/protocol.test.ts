import { describe, expect, it } from 'vitest';
import { MAX_REQUEST_BYTES, parseRequest, parseResult } from '../src/protocol.ts';

const JOB = '0198a7a0-0000-7000-8000-000000000001';
const OUTPUTS = [
  { variant: 'thumbnail', width: 160, height: 320 },
  { variant: 'preview', width: 800, height: 1600 },
];

describe('EVM-068 AC5 the request of the protocol is exactly a job id and a type of the allow-list', () => {
  it('EVM-068 AC5 accepts the two fields and nothing else', () => {
    expect(parseRequest(JSON.stringify({ jobId: JOB, contentType: 'image/jpeg' }))).toEqual({ jobId: JOB, contentType: 'image/jpeg' });
    for (const bad of [
      '',
      'not json',
      '[]',
      'null',
      JSON.stringify({ jobId: JOB }),
      JSON.stringify({ jobId: JOB, contentType: 'image/jpeg', path: '/etc/passwd' }),
      JSON.stringify({ jobId: '../../etc', contentType: 'image/jpeg' }),
      JSON.stringify({ jobId: JOB.toUpperCase(), contentType: 'image/jpeg' }),
      JSON.stringify({ jobId: 7, contentType: 'image/jpeg' }),
      JSON.stringify({ jobId: JOB, contentType: 'image/svg+xml' }),
      JSON.stringify({ jobId: JOB, contentType: 7 }),
      JSON.stringify({ jobId: JOB, contentType: 'image/jpeg', pad: 'x'.repeat(MAX_REQUEST_BYTES) }),
    ]) {
      expect(parseRequest(bad)).toBeUndefined();
    }
  });
});

describe('EVM-068 AC3 the result of a child is strictly validated (the child is not trusted)', () => {
  it('EVM-068 AC3 accepts a success with both variants within their edges and a failure with a known code', () => {
    expect(parseResult({ ok: true, outputs: OUTPUTS })).toEqual({ ok: true, outputs: OUTPUTS });
    for (const code of ['pixel_limit', 'unsupported', 'timeout', 'internal'])
      expect(parseResult({ ok: false, code })).toEqual({ ok: false, code });
  });

  it('EVM-068 AC3 refuses an unknown code, extra fields, a wrong count, a repeated variant, a size beyond the edge and non-integers', () => {
    const bad: unknown[] = [
      null,
      'ok',
      [],
      { ok: false, code: 'disk_on_fire' },
      { ok: false, code: 7 },
      { ok: false, code: 'internal', message: 'path /secret' },
      { ok: 'yes', outputs: OUTPUTS },
      { ok: true },
      { ok: true, outputs: 'x' },
      { ok: true, outputs: OUTPUTS.slice(0, 1) },
      { ok: true, outputs: [OUTPUTS[0], OUTPUTS[0]] },
      { ok: true, outputs: [OUTPUTS[0], 'x'] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'preview', width: 800, height: 1600, path: '/x' }] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'original', width: 10, height: 10 }] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'preview', width: 1601, height: 10 }] },
      { ok: true, outputs: [{ variant: 'thumbnail', width: 321, height: 10 }, OUTPUTS[1]] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'preview', width: 0, height: 10 }] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'preview', width: 10.5, height: 10 }] },
      { ok: true, outputs: [OUTPUTS[0], { variant: 'preview', width: '10', height: 10 }] },
      { ok: true, outputs: OUTPUTS, extra: 1 },
    ];
    for (const value of bad) expect(parseResult(value)).toBeUndefined();
  });
});
