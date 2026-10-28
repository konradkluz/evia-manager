import { describe, expect, it } from 'vitest';
import { ANONYMIZED_DISPLAY_NAME, ANONYMIZED_PHONE, neutralValuesOf } from '../../src/modules/customers/domain/anonymized-customer.ts';
import { rethrowLockWait } from '../../src/modules/customers/domain/lock-wait.ts';
import { ProblemException, problemBody } from '../../src/platform/http/problem.ts';

describe('the neutral values of an anonymized customer (EVM-041 AC4; SR-DATA-08)', () => {
  it('EVM-041 AC4 a person is "Klient zanonimizowany" (first name + last name), a company has that company name; the telephone is the constant', () => {
    expect(neutralValuesOf('person')).toEqual({
      firstName: 'Klient',
      lastName: 'zanonimizowany',
      companyName: null,
      phone: '+48000000000',
    });
    expect(neutralValuesOf('company')).toEqual({
      firstName: null,
      lastName: null,
      companyName: 'Klient zanonimizowany',
      phone: '+48000000000',
    });
    expect(`${neutralValuesOf('person').firstName} ${neutralValuesOf('person').lastName}`).toBe(ANONYMIZED_DISPLAY_NAME);
  });

  it('EVM-041 AC4 the constant telephone fits the format of the column (E.164) and is not a number anybody can have (no area code 0)', () => {
    expect(ANONYMIZED_PHONE).toMatch(/^\+[1-9][0-9]{7,14}$/);
    expect(ANONYMIZED_PHONE).toBe('+48000000000');
  });
});

describe('a lock wait that ran out (EVM-041; RR-NOC-T2-4)', () => {
  it.each(['57014', '55P03'])('EVM-041 AC5 SQLSTATE %s is 503 service_unavailable with Retry-After', (code) => {
    let thrown: unknown;
    try {
      rethrowLockWait(Object.assign(new Error('canceling statement'), { code }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    expect((thrown as ProblemException).code).toBe('service_unavailable');
    expect((thrown as ProblemException).extras.retryAfterSeconds).toBe(2);
  });

  it('EVM-041 AC5 any other error is passed on untouched (a problem, a constraint, a thing that is not an error)', () => {
    const problem = new ProblemException('not_found');
    expect(() => rethrowLockWait(problem)).toThrow(problem);
    const other = Object.assign(new Error('x'), { code: '23514' });
    expect(() => rethrowLockWait(other)).toThrow(other);
    expect(() => rethrowLockWait('text')).toThrow('text');
    expect(() => rethrowLockWait(null)).toThrow();
  });
});

describe('the problem of a customer with open orders (EVM-041 AC2; SR-ERR-02)', () => {
  it('EVM-041 AC2 openWorkOrders is a number in the body; absent when not given; the other codes of the customer have fixed titles', () => {
    expect(problemBody('has_active_dependents', 'a'.repeat(32), undefined, undefined, 2)).toMatchObject({ status: 409, openWorkOrders: 2 });
    expect(problemBody('has_active_dependents', 'a'.repeat(32))).not.toHaveProperty('openWorkOrders');
    expect(problemBody('customer_anonymized', 'a'.repeat(32))).toMatchObject({ status: 409, code: 'customer_anonymized' });
    expect(problemBody('already_anonymized', 'a'.repeat(32))).toMatchObject({ status: 409, code: 'already_anonymized' });
  });
});
