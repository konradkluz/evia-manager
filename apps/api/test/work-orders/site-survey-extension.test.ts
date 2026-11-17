import { describe, expect, it } from 'vitest';
import {
  SITE_SURVEY_EXTENSION_REASONS,
  decideExtension,
  deadlineAfterExtension,
  reminderHorizon,
  type ExtendableOrder,
} from '../../src/modules/work-orders/domain/site-survey-extension.ts';

const DEADLINE = new Date('2027-02-14T08:00:00.000Z');
const survey = (over: Partial<ExtendableOrder> = {}): ExtendableOrder => ({
  customerId: null,
  siteSurveyExpiresAt: DEADLINE,
  extensions: 0,
  status: 'quoting',
  version: 3,
  ...over,
});

describe('the decision of the extension of a site survey (EVM-140 AC2, AC3; ADR-0024 pt 9)', () => {
  it('EVM-140 AC2 the deadline moves 90 days from the current one and the counter grows (0 -> 1 -> 2)', () => {
    expect(decideExtension(3, survey())).toEqual({ kind: 'extend', expiresAt: new Date('2027-05-15T08:00:00.000Z'), extensions: 1 });
    expect(decideExtension(3, survey({ extensions: 1 }))).toEqual({
      kind: 'extend',
      expiresAt: new Date('2027-05-15T08:00:00.000Z'),
      extensions: 2,
    });
    expect(deadlineAfterExtension(DEADLINE).getTime() - DEADLINE.getTime()).toBe(90 * 86_400_000);
  });

  it('EVM-140 AC2 the closed list of reasons has the three codes', () => {
    expect(SITE_SURVEY_EXTENSION_REASONS).toEqual(['awaiting_client_decision', 'awaiting_community_decision', 'second_visit_needed']);
  });

  it('EVM-140 AC3 the third extension is extension_limit_reached (270 days at most)', () => {
    expect(decideExtension(3, survey({ extensions: 2 }))).toEqual({ kind: 'refuse', code: 'extension_limit_reached' });
  });

  it('EVM-140 AC3 an order with a customer, an ordinary order and a cancelled survey are invalid_state_transition', () => {
    const expected = { kind: 'refuse', code: 'invalid_state_transition' };
    expect(decideExtension(3, survey({ customerId: '0198b0a0-0000-4000-8000-000000000001', siteSurveyExpiresAt: null }))).toEqual(expected);
    expect(decideExtension(3, survey({ siteSurveyExpiresAt: null }))).toEqual(expected);
    expect(decideExtension(3, survey({ status: 'cancelled' }))).toEqual(expected);
  });

  it('EVM-140 AC3 a stale version is version_conflict, after the questions of the state and of the limit', () => {
    expect(decideExtension(2, survey())).toEqual({ kind: 'refuse', code: 'version_conflict' });
    expect(decideExtension(2, survey({ extensions: 2 }))).toEqual({ kind: 'refuse', code: 'extension_limit_reached' });
    expect(decideExtension(2, survey({ status: 'cancelled' }))).toEqual({ kind: 'refuse', code: 'invalid_state_transition' });
  });

  it('EVM-140 AC1 the reminder horizon is 15 days from now', () => {
    expect(reminderHorizon(new Date('2027-01-30T08:00:00.000Z'))).toEqual(new Date('2027-02-14T08:00:00.000Z'));
  });
});
