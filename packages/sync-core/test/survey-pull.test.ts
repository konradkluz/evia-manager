import { describe, expect, it } from 'vitest';
import { parseChange, parseClientConfig } from '../src/pull-parse.ts';
import { SERVER_NOW, iso, upsert } from './pull-helpers.ts';

const survey = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  expiresAt: iso(SERVER_NOW),
  extensionCount: 1,
  requesterPhone: null,
  ...extra,
});
const read = (value: unknown, withField = true) => {
  const parsed = parseChange(upsert('work_order', 1, 2, withField ? { customerId: null, siteSurvey: value } : { customerId: null }));
  return parsed.kind === 'upsert' ? parsed.entity.fields['siteSurvey'] : parsed.kind;
};

describe('site survey in the work order projection (EVM-137 AC4, AC7)', () => {
  it('EVM-137 AC4: an open survey is read with its term, extensions and the phone of the requester (or null)', () => {
    expect(read(survey())).toEqual({ expiresAt: iso(SERVER_NOW), extensionCount: 1, requesterPhone: null });
    expect(read(survey({ requesterPhone: '+48600000011' }))).toMatchObject({ requesterPhone: '+48600000011' });
  });

  it('EVM-137 AC7: a work order the office gave a customer arrives with siteSurvey null: the mark is gone', () => {
    const parsed = parseChange(upsert('work_order', 1, 3, { siteSurvey: null }));
    expect(parsed.kind === 'upsert' && parsed.entity.fields['siteSurvey']).toBeNull();
  });

  it('EVM-137 AC4: a server without the field (before EVM-135) is read as "not a survey", not as an invalid change', () => {
    expect(read(undefined, false)).toBeNull();
  });

  it('EVM-137 AC4: a malformed survey makes the change invalid and never reaches the replica', () => {
    for (const bad of [
      'x',
      [],
      survey({ extensionCount: 3 }),
      survey({ extensionCount: -1 }),
      survey({ extensionCount: 1.5 }),
      survey({ expiresAt: 'tomorrow' }),
      survey({ requesterPhone: 'x'.repeat(33) }),
      survey({ requesterPhone: 5 }),
    ])
      expect(read(bad), JSON.stringify(bad)).toBe('invalid');
  });

  it('EVM-137 AC4: strict mode accepts the contract field; a sibling field of the survey is not copied', () => {
    const wire = upsert('work_order', 1, 2, { customerId: null, siteSurvey: survey({ street: 'ul. Fikcyjna' }) });
    expect(parseChange(wire, { strict: true }).kind).toBe('upsert');
    expect(JSON.stringify(parseChange(wire))).not.toContain('Fikcyjna');
  });
});

describe('the switch of the site survey in the client config (EVM-137 AC1)', () => {
  it('EVM-137 AC1: only a boolean true switches the action on; missing, null, a string or another shape means off', () => {
    expect(parseClientConfig({ features: { siteSurveys: true } }).features.siteSurveys).toBe(true);
    for (const features of [undefined, null, {}, { siteSurveys: false }, { siteSurveys: 'true' }, { siteSurveys: 1 }, [], 'on'])
      expect(parseClientConfig({ features }).features.siteSurveys, JSON.stringify(features)).toBe(false);
    expect(parseClientConfig(null).features.siteSurveys).toBe(false);
  });
});
