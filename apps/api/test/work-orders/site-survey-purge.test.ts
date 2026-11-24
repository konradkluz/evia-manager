import { describe, expect, it } from 'vitest';
import { ProceduresSurveyPurgeParticipant } from '../../src/modules/procedures/application/site-survey-purge.participant.ts';
import { TimelineSurveyPurgeParticipant } from '../../src/modules/timeline/application/site-survey-purge.participant.ts';
import { ANONYMIZED_SITE_VALUES } from '../../src/modules/sites/domain/anonymized-site.ts';
import { SITE_SURVEY_REJECTED_DAYS } from '../../src/modules/work-orders/domain/site-survey-deadline.ts';
import { SITE_SURVEY_EXTENSION_DAYS, SITE_SURVEY_MAX_EXTENSIONS } from '../../src/modules/work-orders/domain/site-survey-extension.ts';
import {
  DEFAULT_SITE_SURVEY_PURGE_MODE,
  SITE_MADE_FOR_SURVEY_WINDOW_MS,
  SITE_SURVEY_PURGE_LIMIT_PER_RUN,
  SITE_SURVEY_PURGE_MODES,
  isPurgeCandidate,
  siteMadeForSurveyWindow,
} from '../../src/modules/work-orders/domain/site-survey-purge.ts';
import { SITE_SURVEY_RETENTION_DAYS, siteSurveyExpiry } from '../../src/modules/work-orders/domain/site-survey.ts';
import {
  SiteSurveyPurgeRegistry,
  SurveyChangedDuringPurge,
  SurveyPurgeInvariantViolated,
  type SiteSurveyPurgeParticipant,
} from '../../src/modules/work-orders/site-survey-purge-participant.ts';

const DAY = 86_400_000;
const CREATED = new Date('2027-01-01T08:00:00.000Z');
const order = (over: Partial<Parameters<typeof isPurgeCandidate>[0]> = {}) => ({
  siteSurveyExpiresAt: siteSurveyExpiry(CREATED),
  customerId: null,
  siteSurveyPurgedAt: null,
  ...over,
});

describe('the candidates of the purge of a site survey (EVM-139 AC1, AC6; SR-PRIV-01, SR-PRIV-11)', () => {
  it('EVM-139 AC6 the periods are constants of the code: 90 days, two extensions of 90, 14 days for a rejected survey', () => {
    expect(SITE_SURVEY_RETENTION_DAYS).toBe(90);
    expect(SITE_SURVEY_EXTENSION_DAYS).toBe(90);
    expect(SITE_SURVEY_MAX_EXTENSIONS).toBe(2);
    expect(SITE_SURVEY_REJECTED_DAYS).toBe(14);
    expect(SITE_SURVEY_PURGE_MODES).toEqual(['report', 'enforce']);
    expect(DEFAULT_SITE_SURVEY_PURGE_MODE).toBe('report');
    expect(SITE_SURVEY_PURGE_LIMIT_PER_RUN).toBe(50);
  });

  it('EVM-139 AC1 AC6 the boundary of 90 days: day 89 and the instant of the deadline are no candidates, a moment after the deadline (day 91) is one', () => {
    const at = (days: number, extraMs = 0) => new Date(CREATED.getTime() + days * DAY + extraMs);
    expect(isPurgeCandidate(order(), at(89))).toBe(false);
    expect(isPurgeCandidate(order(), at(90, -1))).toBe(false);
    expect(isPurgeCandidate(order(), at(90))).toBe(false);
    expect(isPurgeCandidate(order(), at(90, 1))).toBe(true);
    expect(isPurgeCandidate(order(), at(91))).toBe(true);
  });

  it('EVM-139 AC3 a survey with a customer, one without a deadline and one that is purged already are never candidates', () => {
    const late = new Date(CREATED.getTime() + 400 * DAY);
    expect(isPurgeCandidate(order({ customerId: '0190a1b2-0000-7000-8000-0000000000c1' }), late)).toBe(false);
    expect(isPurgeCandidate(order({ siteSurveyExpiresAt: null }), late)).toBe(false);
    expect(isPurgeCandidate(order({ siteSurveyPurgedAt: late }), late)).toBe(false);
    expect(isPurgeCandidate(order(), late)).toBe(true);
  });

  it('EVM-139 AC2 the location made for a survey is the one made by the same person within 24 hours BEFORE the survey', () => {
    const window = siteMadeForSurveyWindow(CREATED);
    expect(window.notAfter).toEqual(CREATED);
    expect(CREATED.getTime() - window.notBefore.getTime()).toBe(SITE_MADE_FOR_SURVEY_WINDOW_MS);
    expect(SITE_MADE_FOR_SURVEY_WINDOW_MS).toBe(24 * 3_600_000);
  });

  it('EVM-139 AC2 the neutral values of an anonymized location keep the shape the columns demand (the postal code and the building number have a format)', () => {
    expect(ANONYMIZED_SITE_VALUES.postal_code).toMatch(/^[0-9]{2}-[0-9]{3}$/);
    expect(ANONYMIZED_SITE_VALUES.building_number.length).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(ANONYMIZED_SITE_VALUES)).toBe(true);
  });
});

describe('the registry of the participants of the purge (EVM-139 AC2)', () => {
  const participant = (name: string, position: number): SiteSurveyPurgeParticipant => ({
    name,
    order: position,
    identify: () => Promise.resolve({ mediaAssetIds: [], documentIds: [], holdsSite: false }),
    erase: () => Promise.resolve(undefined),
  });

  it('EVM-139 AC2 it fails closed when nobody is registered, keeps the order, and refuses a second participant with the same name', () => {
    const registry = new SiteSurveyPurgeRegistry();
    expect(() => registry.ordered()).toThrow('no site survey purge participant is registered');
    registry.register(participant('timeline', 200));
    registry.register(participant('media', 100));
    registry.register(participant('another', 100));
    expect(registry.ordered().map((p) => p.name)).toEqual(['another', 'media', 'timeline']);
    expect(registry.names()).toEqual(['another', 'media', 'timeline']);
    expect(() => {
      registry.register(participant('media', 1));
    }).toThrow('already registered');
  });

  it('EVM-139 AC2 participants of one position run by name whatever the order of registration', () => {
    const registry = new SiteSurveyPurgeRegistry();
    for (const name of ['c', 'a', 'd', 'b']) registry.register(participant(name, 10));
    expect(registry.ordered().map((p) => p.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the signal of a changed survey (EVM-139 AC2)', () => {
  it('EVM-139 AC2 SurveyChangedDuringPurge is a named error that says the survey changed between the register entry and the erasure', () => {
    const error = new SurveyChangedDuringPurge();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SurveyChangedDuringPurge');
    expect(error.message).toBe('site survey purge: the survey changed between the register entry and the erasure');
  });
});

describe('the signal of a broken invariant (EVM-147 AC5; ADR-0025 pt 4)', () => {
  it('EVM-147 AC5 SurveyPurgeInvariantViolated carries the fixed code change_note_invariant and no value', () => {
    const error = new SurveyPurgeInvariantViolated('change_note_invariant');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SurveyPurgeInvariantViolated');
    expect(error.code).toBe('change_note_invariant');
    expect(error.message).toBe('site survey purge: an invariant of the erasure is broken (change_note_invariant)');
  });
});

describe('the participants without documents declare none (EVM-147 AC5; ADR-0025 pt 4)', () => {
  it('EVM-147 AC5 procedures and timeline hold no media and no document and do not hold the location; they register themselves', async () => {
    const registry = new SiteSurveyPurgeRegistry();
    const procedures = new ProceduresSurveyPurgeParticipant(registry);
    const timeline = new TimelineSurveyPurgeParticipant(registry);
    procedures.onModuleInit();
    timeline.onModuleInit();
    expect(registry.names()).toEqual(['procedures', 'timeline']);
    for (const participant of [procedures, timeline]) {
      expect(await participant.identify()).toEqual({ mediaAssetIds: [], documentIds: [], holdsSite: false });
    }
  });
});
