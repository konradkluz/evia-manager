// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUSINESS_TIME_ZONE, isValidIsoDate, todayInZone } from '../lib/dates.mjs';

describe('daty (EVM-012)', () => {
  it('EVM-012 AC3: poprawne daty YYYY-MM-DD, w tym 29 lutego w latach przestępnych', () => {
    for (const date of ['2026-10-02', '2026-01-31', '2026-12-31', '2024-02-29', '2000-02-29', '2026-04-30']) {
      assert.equal(isValidIsoDate(date), true, date);
    }
  });

  it('EVM-012 AC3: niepoprawne daty — zły format albo nieistniejący dzień kalendarza', () => {
    const invalid = [
      '2026-13-01',
      '02.10.2026',
      '2026-02-30',
      '2026-02-29',
      '2100-02-29',
      '2026-00-10',
      '2026-10-00',
      '2026-04-31',
      '2026-1-01',
      ' 2026-10-02',
      '2026-10-02T00:00',
      '',
    ];
    for (const date of invalid) {
      assert.equal(isValidIsoDate(date), false, date);
    }
  });

  it('EVM-012 AC4: „dzisiaj” liczone w strefie Europe/Warsaw — granica doby (czas letni)', () => {
    assert.equal(BUSINESS_TIME_ZONE, 'Europe/Warsaw');
    assert.equal(todayInZone(new Date('2026-10-01T21:59:59Z')), '2026-10-01');
    assert.equal(todayInZone(new Date('2026-10-01T22:00:00Z')), '2026-10-02');
  });

  it('EVM-012 AC4: granica doby wokół zmiany czasu (25 października 2026)', () => {
    assert.equal(todayInZone(new Date('2026-10-24T21:59:59Z')), '2026-10-24');
    assert.equal(todayInZone(new Date('2026-10-24T22:00:00Z')), '2026-10-25');
    assert.equal(todayInZone(new Date('2026-10-25T22:59:59Z')), '2026-10-25');
    assert.equal(todayInZone(new Date('2026-10-25T23:00:00Z')), '2026-10-26');
  });

  it('EVM-012 AC4: strefę można wskazać jawnie (niezależnie od strefy systemu)', () => {
    assert.equal(todayInZone(new Date('2026-10-01T22:30:00Z'), 'UTC'), '2026-10-01');
  });
});
