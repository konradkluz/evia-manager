import { describe, expect, it } from 'vitest';
import { businessDate } from '../../src/modules/work-orders/domain/business-date.ts';
import { normalizeTransitionFields } from '../../src/modules/work-orders/domain/transition-input.ts';
import { findTransition, type ResolvedTransition } from '../../src/modules/work-orders/domain/work-order-transitions.ts';

const TODAY = '2026-10-08';
const row = (from: Parameters<typeof findTransition>[0]['status'], to: Parameters<typeof findTransition>[1]): ResolvedTransition => {
  const found = findTransition({ status: from, resumeStatus: from === 'on_hold' ? 'accepted' : null }, to);
  if (found === undefined) throw new Error(`no row ${from} > ${to}`);
  return found;
};
const HOLD = row('in_progress', 'on_hold');
const COMPLETE = row('in_progress', 'completed');
const PLAIN = row('new', 'quoting');

describe('the fields of a transition (EVM-030 AC2, AC3; SR-INPUT-01, SR-DATA-01)', () => {
  it('EVM-030 AC2 the reason of a hold is required: absent, empty and only spaces are all "required"', () => {
    for (const reason of [undefined, '', '   ', '\t']) {
      expect(normalizeTransitionFields({ to: 'on_hold', reason }, HOLD, TODAY), String(reason)).toEqual({
        ok: false,
        errors: [{ pointer: '/reason', code: 'required' }],
      });
    }
  });

  it('EVM-030 AC2 the reason is NFC and trimmed, 500 characters pass, 501 are "too_long" (the count is of the normalised text)', () => {
    const decomposed = 'Zalegáły termin'; // "ł" typed with a combining accent: NFC has one character fewer
    const result = normalizeTransitionFields({ to: 'on_hold', reason: `  ${decomposed}  ` }, HOLD, TODAY);
    expect(result).toEqual({ ok: true, fields: { reason: decomposed.normalize('NFC'), completedOn: null } });
    expect(normalizeTransitionFields({ to: 'on_hold', reason: 'a'.repeat(500) }, HOLD, TODAY).ok).toBe(true);
    expect(normalizeTransitionFields({ to: 'on_hold', reason: 'a'.repeat(501) }, HOLD, TODAY)).toEqual({
      ok: false,
      errors: [{ pointer: '/reason', code: 'too_long' }],
    });
  });

  it('EVM-030 AC2 a control character in the reason is "invalid_characters" — and the error never carries the text', () => {
    const result = normalizeTransitionFields({ to: 'on_hold', reason: 'tajny-powód-syntetyczny\u0000' }, HOLD, TODAY);
    expect(result).toEqual({ ok: false, errors: [{ pointer: '/reason', code: 'invalid_characters' }] });
    expect(JSON.stringify(result)).not.toContain('tajny');
  });

  it('EVM-030 AC1 a transition that takes no reason refuses one ("not_allowed") and ignores nothing silently', () => {
    expect(normalizeTransitionFields({ to: 'quoting', reason: 'po co' }, PLAIN, TODAY)).toEqual({
      ok: false,
      errors: [{ pointer: '/reason', code: 'not_allowed' }],
    });
    expect(normalizeTransitionFields({ to: 'quoting' }, PLAIN, TODAY)).toEqual({ ok: true, fields: { reason: null, completedOn: null } });
  });

  it('EVM-030 AC1 "Zakończ": the completion day is today (Warsaw) by default, a given day is kept, the bounds are 2000-01-01 and today', () => {
    expect(normalizeTransitionFields({ to: 'completed' }, COMPLETE, TODAY)).toEqual({
      ok: true,
      fields: { reason: null, completedOn: TODAY },
    });
    expect(normalizeTransitionFields({ to: 'completed', completedOn: '2026-10-01' }, COMPLETE, TODAY)).toMatchObject({
      ok: true,
      fields: { completedOn: '2026-10-01' },
    });
    expect(normalizeTransitionFields({ to: 'completed', completedOn: '2000-01-01' }, COMPLETE, TODAY).ok).toBe(true);
    expect(normalizeTransitionFields({ to: 'completed', completedOn: TODAY }, COMPLETE, TODAY).ok).toBe(true);
    for (const completedOn of ['1999-12-31', '2026-10-09', '2100-01-01']) {
      expect(normalizeTransitionFields({ to: 'completed', completedOn }, COMPLETE, TODAY), completedOn).toEqual({
        ok: false,
        errors: [{ pointer: '/completedOn', code: 'out_of_range' }],
      });
    }
  });

  it('EVM-030 AC1 the completion day is refused where the row does not set it ("not_allowed"): on "Rozlicz" and on a restoration to "Zakończone"', () => {
    for (const transition of [row('completed', 'settled'), row('settled', 'completed'), PLAIN]) {
      expect(normalizeTransitionFields({ to: transition.to, completedOn: '2026-10-01' }, transition, TODAY)).toEqual({
        ok: false,
        errors: [{ pointer: '/completedOn', code: 'not_allowed' }],
      });
    }
  });

  it('EVM-030 AC4 a restoration to "Wstrzymane" takes no reason (the document names none), although a hold does', () => {
    const restore = row('cancelled', 'on_hold');
    expect(normalizeTransitionFields({ to: 'on_hold' }, restore, TODAY)).toEqual({ ok: true, fields: { reason: null, completedOn: null } });
    expect(normalizeTransitionFields({ to: 'on_hold', reason: 'x' }, restore, TODAY)).toMatchObject({ ok: false });
  });

  it('EVM-030 AC1 all the errors come at once, each a pointer and a code', () => {
    expect(normalizeTransitionFields({ to: 'on_hold', reason: undefined, completedOn: '2026-01-01' }, HOLD, TODAY)).toEqual({
      ok: false,
      errors: [
        { pointer: '/reason', code: 'required' },
        { pointer: '/completedOn', code: 'not_allowed' },
      ],
    });
  });
});

describe('the business day (Europe/Warsaw; EVM-030 AC1)', () => {
  it('EVM-030 AC1 the day of an instant is the Warsaw day, not the UTC one: 23:30 UTC in summer is already tomorrow, 22:30 UTC in winter is not yet', () => {
    expect(businessDate(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02'); // CEST, UTC+2
    expect(businessDate(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
    expect(businessDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01'); // CET, UTC+1
    expect(businessDate(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
  });
});

describe('the reason code of the rejection of a site survey (EVM-136 AC5; decision 11)', () => {
  const CANCEL = row('quoting', 'cancelled');
  const survey = { siteSurvey: true } as const;

  it('EVM-136 AC5 a survey is rejected with offer_rejected or customer_withdrew - a fixed code, stored as the reason - and the free text is not allowed', () => {
    for (const code of ['offer_rejected', 'customer_withdrew'] as const) {
      expect(normalizeTransitionFields({ to: 'cancelled', reasonCode: code }, CANCEL, TODAY, survey)).toEqual({
        ok: true,
        fields: { reason: code, completedOn: null },
      });
    }
    expect(
      normalizeTransitionFields({ to: 'cancelled', reasonCode: 'offer_rejected', reason: 'Jan Przykładowy' }, CANCEL, TODAY, survey),
    ).toEqual({
      ok: false,
      errors: [{ pointer: '/reason', code: 'not_allowed' }],
    });
  });

  it('EVM-136 AC5 the rejection of a survey without a code, or with an empty or unknown one, is "required" at /reasonCode - never an echo of a value', () => {
    for (const reasonCode of [undefined, 'wrong', 'Oferta odrzucona']) {
      const result = normalizeTransitionFields({ to: 'cancelled', reasonCode: reasonCode as never }, CANCEL, TODAY, survey);
      expect(result, String(reasonCode)).toEqual({
        ok: false,
        errors: [{ pointer: '/reasonCode', code: reasonCode === undefined ? 'required' : 'invalid_value' }],
      });
    }
  });

  it('EVM-136 AC5 an ordinary order is cancelled as before - the free reason is required - and the code is "not_allowed" there (no dead write); the hold of a survey keeps its free reason', () => {
    expect(normalizeTransitionFields({ to: 'cancelled', reason: 'Powód' }, CANCEL, TODAY)).toEqual({
      ok: true,
      fields: { reason: 'Powód', completedOn: null },
    });
    expect(normalizeTransitionFields({ to: 'cancelled', reason: 'Powód', reasonCode: 'offer_rejected' }, CANCEL, TODAY)).toEqual({
      ok: false,
      errors: [{ pointer: '/reasonCode', code: 'not_allowed' }],
    });
    const hold = row('quoting', 'on_hold');
    expect(normalizeTransitionFields({ to: 'on_hold', reason: 'Czekamy' }, hold, TODAY, survey)).toEqual({
      ok: true,
      fields: { reason: 'Czekamy', completedOn: null },
    });
    expect(normalizeTransitionFields({ to: 'on_hold', reason: 'Czekamy', reasonCode: 'offer_rejected' }, hold, TODAY, survey)).toEqual({
      ok: false,
      errors: [{ pointer: '/reasonCode', code: 'not_allowed' }],
    });
  });
});
