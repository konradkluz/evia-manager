import { describe, expect, it } from 'vitest';
import { addDays, moveFields } from '../../src/modules/payments/domain/milestone-transitions.ts';
import { businessDate } from '../../src/platform/clock/business-date.ts';

const facts = { amountMinor: 123_000, paymentTermDays: 7 } as const;

describe('edge cases of the milestone moves (EVM-054 AC1 AC2 AC3; Europe/Warsaw, Polish characters)', () => {
  it('EVM-054 AC1 the due date is calendar arithmetic: it does not move across the autumn (2026-10-25) and the spring (2027-03-28) change of time', () => {
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2027-03-27', 7)).toBe('2027-04-03');
    expect(addDays('2027-03-28', 0)).toBe('2027-03-28');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('EVM-054 AC2 "today" is the day of Warsaw: 22:30 UTC on 2026-10-03 is already 2026-10-04 — a payment of that day is allowed, of the next one is 422 in_future', () => {
    const today = businessDate(new Date('2026-10-03T22:30:00.000Z'));
    expect(today).toBe('2026-10-04');
    expect(moveFields('pay', { to: 'paid', paidOn: '2026-10-04' }, facts, today)).toMatchObject({ ok: true });
    expect(moveFields('pay', { to: 'paid', paidOn: '2026-10-05' }, facts, today)).toEqual({
      ok: false,
      status: 422,
      errors: [{ pointer: '/paidOn', code: 'in_future' }],
    });
    // 21:59 UTC in winter time (CET, UTC+1) is still the same day in Warsaw; 23:00 UTC is the next one
    expect(businessDate(new Date('2026-12-10T22:59:00.000Z'))).toBe('2026-12-10');
    expect(businessDate(new Date('2026-12-10T23:00:00.000Z'))).toBe('2026-12-11');
  });

  it('EVM-054 AC1 AC3 Polish characters in the invoice number and in the reason are kept as they are', () => {
    const invoice = moveFields(
      'invoice',
      { to: 'invoiced', invoiceNumber: 'FV/Zażółć-Łódź/ąćęłńóśźż/2026', invoicedOn: '2026-10-03' },
      facts,
      '2026-10-03',
    );
    expect(invoice).toMatchObject({ ok: true, update: { invoiceNumber: 'FV/Zażółć-Łódź/ąćęłńóśźż/2026', dueDate: '2026-10-10' } });
    const cancel = moveFields('cancel', { to: 'cancelled', reason: 'Klient zrezygnował — „Łódź”, żółć' }, facts, '2026-10-03');
    expect(cancel).toMatchObject({ ok: true, update: { status: 'cancelled', statusReason: 'Klient zrezygnował — „Łódź”, żółć' } });
  });
});
