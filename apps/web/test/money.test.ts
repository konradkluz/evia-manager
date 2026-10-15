import { describe, expect, it } from 'vitest';
import { MONEY_MAX_MINOR, formatAmountInput, formatMoney, parseAmount } from '../src/work-orders/money.ts';

const NBSP = '\u00a0';

describe('amounts of the instalments (EVM-053 AC2, AC3, AC4; styleguide § 6.3)', () => {
  it('EVM-053 AC2 an amount in grosze is shown as "3 600,00 zł" with non-breaking spaces, four-digit numbers grouped too', () => {
    expect(formatMoney(360000)).toBe(`3${NBSP}600,00${NBSP}zł`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}zł`);
    expect(formatMoney(29)).toBe(`0,29${NBSP}zł`);
    expect(formatMoney(150050)).toBe(`1${NBSP}500,50${NBSP}zł`);
    expect(formatMoney(99)).toBe(`0,99${NBSP}zł`);
    expect(formatMoney(100000001)).toBe(`1${NBSP}000${NBSP}000,01${NBSP}zł`);
    expect(formatMoney(MONEY_MAX_MINOR)).toBe(`999${NBSP}999${NBSP}999,99${NBSP}zł`);
    expect(formatMoney(12345)).toBe(`123,45${NBSP}zł`);
  });

  it('EVM-053 AC3 typed text becomes grosze by parsing the digits — never a floating-point multiplication', () => {
    // 0.29 * 100 and 1.15 * 100 are not whole numbers in floating point: the parser must not depend on that
    expect(parseAmount('0,29')).toEqual({ kind: 'amount', amountMinor: 29 });
    expect(parseAmount('1,15')).toEqual({ kind: 'amount', amountMinor: 115 });
    expect(parseAmount('3600,10')).toEqual({ kind: 'amount', amountMinor: 360010 });
    expect(parseAmount('1 000 000,01')).toEqual({ kind: 'amount', amountMinor: 100000001 });
    expect(parseAmount(`3${NBSP}600,00`)).toEqual({ kind: 'amount', amountMinor: 360000 });
    expect(parseAmount('3\u202f600,00 zł')).toEqual({ kind: 'amount', amountMinor: 360000 });
    expect(parseAmount('1500')).toEqual({ kind: 'amount', amountMinor: 150000 });
    expect(parseAmount('1500,5')).toEqual({ kind: 'amount', amountMinor: 150050 });
    expect(parseAmount(' 4800.00 ')).toEqual({ kind: 'amount', amountMinor: 480000 });
    expect(parseAmount('999 999 999,99')).toEqual({ kind: 'amount', amountMinor: MONEY_MAX_MINOR });
    expect(parseAmount('0001,00')).toEqual({ kind: 'amount', amountMinor: 100 });
  });

  it('EVM-053 AC3 more than two decimal places, zero, a negative amount or text that is not an amount is refused before sending', () => {
    expect(parseAmount('3600,101')).toEqual({ kind: 'precision' });
    expect(parseAmount('0,001')).toEqual({ kind: 'precision' });
    expect(parseAmount('0')).toEqual({ kind: 'notPositive' });
    expect(parseAmount('0,00')).toEqual({ kind: 'notPositive' });
    expect(parseAmount('-10')).toEqual({ kind: 'notPositive' });
    expect(parseAmount('\u221210,00')).toEqual({ kind: 'notPositive' });
    expect(parseAmount('abc')).toEqual({ kind: 'invalid' });
    expect(parseAmount('1,2,3')).toEqual({ kind: 'invalid' });
    expect(parseAmount('1e5')).toEqual({ kind: 'invalid' });
    expect(parseAmount(',50')).toEqual({ kind: 'invalid' });
    expect(parseAmount('1 000 000 000,00')).toEqual({ kind: 'tooLarge' });
    expect(parseAmount('')).toEqual({ kind: 'empty' });
    expect(parseAmount('   ')).toEqual({ kind: 'empty' });
  });

  it('EVM-053 AC4 a typed amount is normalised when the field is left ("1500" → "1 500,00"); text that is not an amount stays', () => {
    expect(formatAmountInput('1500')).toBe(`1${NBSP}500,00`);
    expect(formatAmountInput('1500,5')).toBe(`1${NBSP}500,50`);
    expect(formatAmountInput('abc')).toBe('abc');
    expect(formatAmountInput('1,234')).toBe('1,234');
    expect(formatAmountInput('')).toBe('');
  });
});
