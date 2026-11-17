import { createUuidV7 } from '@evia/sync-core';
import {
  buildSurveyInput,
  EMPTY_SURVEY_DRAFT,
  expiryOf,
  hasSurveyInput,
  pendingSurveyExpiry,
  SURVEY_TERM_DAYS,
  validateSurvey,
  type SurveyDraft,
} from '../../src/orders/site-survey-model';

// EVM-137 AC1, AC2, AC4 (security W5, W8): the pure model of the site survey form and of its term. Synthetic data only.
const DAY = 86_400_000;
const newId = createUuidV7({ now: () => Date.UTC(2026, 10, 16, 9, 0, 0) }, { getRandomValues: (bytes) => bytes.fill(7) });
const good: SurveyDraft = {
  ...EMPTY_SURVEY_DRAFT,
  city: 'Piaseczno',
  street: 'ul. Fikcyjna',
  buildingNumber: '12',
  postalCode: '05-500',
};
const fields = (draft: SurveyDraft) => validateSurvey(draft).map((error) => `${error.field}:${error.problem}`);

describe('validation of the site survey form (EVM-137 AC1)', () => {
  it('EVM-137 AC1: a complete address (city, street, building number, postal code) is valid with no phone and no apartment', () => {
    expect(validateSurvey(good)).toEqual([]);
  });

  it('EVM-137 AC1: city, street, building number and postal code are required, in the order of the form', () => {
    expect(fields(EMPTY_SURVEY_DRAFT)).toEqual(['city:required', 'street:required', 'buildingNumber:required', 'postalCode:required']);
    expect(fields({ ...good, city: '   ', street: '	 ' })).toEqual(['city:required', 'street:required']);
  });

  it('EVM-137 AC1: the limits and patterns equal the contract (EVM-106): 200 / 20 / 20 / 100 characters, NN-NNN', () => {
    expect(fields({ ...good, street: 'x'.repeat(201) })).toEqual(['street:too_long']);
    expect(fields({ ...good, buildingNumber: '1'.repeat(21) })).toEqual(['buildingNumber:too_long']);
    expect(fields({ ...good, apartmentNumber: '1'.repeat(21) })).toEqual(['apartmentNumber:too_long']);
    expect(fields({ ...good, city: 'x'.repeat(101) })).toEqual(['city:too_long']);
    for (const bad of ['05500', '5-500', '05-50', 'ab-cde', '05-5000'])
      expect(fields({ ...good, postalCode: bad })).toEqual(['postalCode:format']);
  });

  it('EVM-137 AC1: the phone of the requester is optional - an error only when it is typed and wrong', () => {
    expect(validateSurvey({ ...good, requesterPhone: '' })).toEqual([]);
    expect(validateSurvey({ ...good, requesterPhone: '   ' })).toEqual([]);
    expect(validateSurvey({ ...good, requesterPhone: '+48 600 000 011' })).toEqual([]);
    for (const bad of ['12', 'abc', '600-000-0x1', '+'.repeat(40), '######'])
      expect(fields({ ...good, requesterPhone: bad })).toEqual(['requesterPhone:format']);
  });

  it('EVM-137 AC1 W5: an error is a field and a problem - never the text that was typed', () => {
    const typed = 'Tajna Ulica 99';
    const errors = validateSurvey({ ...good, street: typed + 'x'.repeat(200), requesterPhone: 'Jan Kowalski' });
    expect(JSON.stringify(errors)).not.toContain('Tajna');
    expect(JSON.stringify(errors)).not.toContain('Kowalski');
  });

  it('EVM-137 AC1: hasSurveyInput tells a touched form from an empty one (the question before leaving)', () => {
    expect(hasSurveyInput(EMPTY_SURVEY_DRAFT)).toBe(false);
    expect(hasSurveyInput({ ...EMPTY_SURVEY_DRAFT, requesterPhone: '  ' })).toBe(false);
    expect(hasSurveyInput({ ...EMPTY_SURVEY_DRAFT, city: 'x' })).toBe(true);
  });
});

describe('the command of the site survey (EVM-137 AC2, W8)', () => {
  it('EVM-137 AC2: CreateSiteSurvey v1 with new ids, the place "other" and no client, template, title or note (W8)', () => {
    const built = buildSurveyInput(good, newId);
    if (!built.ok) throw new Error('expected a command');
    expect(built.input).toEqual({ type: 'CreateSiteSurvey', commandVersion: 1, payload: built.payload });
    expect(built.payload).toEqual({
      workOrderId: built.workOrderId,
      newSite: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        siteType: 'other',
        street: 'ul. Fikcyjna',
        buildingNumber: '12',
        postalCode: '05-500',
        city: 'Piaseczno',
      },
    });
    for (const forbidden of ['title', 'note', 'customerId', 'newCustomer', 'templateId', 'siteId'])
      expect(built.payload).not.toHaveProperty(forbidden);
  });

  it('EVM-137 AC2: the apartment and the phone are sent only when typed (cleaned); the phone name is the contract field requesterPhone', () => {
    const built = buildSurveyInput({ ...good, apartmentNumber: ' 4 ', requesterPhone: ' +48  600 000 011 ' }, newId);
    if (!built.ok) throw new Error('expected a command');
    expect(built.payload['requesterPhone']).toBe('+48 600 000 011');
    expect((built.payload['newSite'] as Record<string, unknown>)['apartmentNumber']).toBe('4');
    const bare = buildSurveyInput(good, newId);
    if (!bare.ok) throw new Error('expected a command');
    expect(bare.payload).not.toHaveProperty('requesterPhone');
    expect(bare.payload['newSite']).not.toHaveProperty('apartmentNumber');
  });

  it('EVM-137 AC2: every save takes new ids (the survey and the place), so one touch is one command and a second save is another survey', () => {
    const a = buildSurveyInput(good, newId);
    const b = buildSurveyInput(good, newId);
    if (!a.ok || !b.ok) throw new Error('expected commands');
    expect(a.workOrderId).not.toBe(b.workOrderId);
    expect((a.payload['newSite'] as { id: string }).id).not.toBe((b.payload['newSite'] as { id: string }).id);
  });

  it('EVM-137 AC1: an invalid draft builds nothing and says which fields', () => {
    expect(buildSurveyInput(EMPTY_SURVEY_DRAFT, newId)).toEqual({
      ok: false,
      errors: [
        { field: 'city', problem: 'required' },
        { field: 'street', problem: 'required' },
        { field: 'buildingNumber', problem: 'required' },
        { field: 'postalCode', problem: 'required' },
      ],
    });
  });
});

describe('the term of a survey (EVM-137 AC4; flow 17, rule 3)', () => {
  // the business zone is Europe/Warsaw: 16.11.2026 is winter time (UTC+1)
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  const at = (days: number) => now + days * DAY;

  it('EVM-137 AC4: the term of a survey that waits in the queue is 90 days from the moment it was saved', () => {
    expect(SURVEY_TERM_DAYS).toBe(90);
    expect(pendingSurveyExpiry(now)).toEqual({ expiresAt: now + 90 * DAY, extensionCount: 0 });
  });

  it('EVM-137 AC4: more than 15 days left is the normal state with the number of days', () => {
    expect(expiryOf(at(90), now)).toEqual({ state: 'normal', days: 90 });
    expect(expiryOf(at(16), now)).toEqual({ state: 'normal', days: 16 });
  });

  it('EVM-137 AC4: 15 days and fewer is the warning (text and icon, never a colour alone)', () => {
    expect(expiryOf(at(15), now)).toEqual({ state: 'warning', days: 15 });
    expect(expiryOf(at(1), now)).toEqual({ state: 'warning', days: 1 });
  });

  it('EVM-137 AC4: on the day of the term it is "today" and after it "overdue" (days are calendar days of Europe/Warsaw)', () => {
    expect(expiryOf(at(0), now)).toEqual({ state: 'today', days: 0 });
    expect(expiryOf(now + 3 * 3_600_000, now)).toEqual({ state: 'today', days: 0 });
    expect(expiryOf(at(-1), now)).toEqual({ state: 'overdue', days: -1 });
    // 23:30 UTC on the 16th is already the 17th in Warsaw: tomorrow, not today
    expect(expiryOf(Date.UTC(2026, 10, 16, 23, 30, 0), Date.UTC(2026, 10, 16, 8, 0, 0))).toEqual({ state: 'warning', days: 1 });
  });
});
