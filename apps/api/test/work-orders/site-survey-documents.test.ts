import { describe, expect, it } from 'vitest';
import {
  awaitsCustomer,
  isRejectedSurvey,
  SITE_SURVEY_DOCUMENT_KINDS,
  siteSurveyDocumentIssues,
} from '../../src/modules/work-orders/domain/site-survey.ts';
import { siteSurveyReminderText } from '../../src/modules/work-orders/domain/site-survey-reminder.ts';

/** The documents a site survey accepts before its customer (EVM-147 AC2, AC3, AC4, AC7; ADR-0025 pt 2, 5). Pure rules, synthetic values. */
const CUSTOMER = '0190a1b2-0000-7000-8000-0000000000c1';

describe('the documents of a site survey before the customer (EVM-147 AC2, AC3)', () => {
  it('EVM-147 AC2 the allowed kinds are ONE closed list in the domain: the offer only', () => {
    expect(SITE_SURVEY_DOCUMENT_KINDS).toEqual(['quote']);
    expect(Object.isFrozen(SITE_SURVEY_DOCUMENT_KINDS)).toBe(true);
  });

  it('EVM-147 AC2 the closed list of the refusals: a kind other than the offer at /kindCode, the class identity_data at /confidentialityOverride - one code, no value', () => {
    expect(siteSurveyDocumentIssues({ kindCode: 'quote' })).toEqual([]);
    expect(siteSurveyDocumentIssues({ kindCode: 'quote', confidentialityOverride: 'building_security' })).toEqual([]);
    expect(siteSurveyDocumentIssues({ kindCode: 'quote', confidentialityOverride: null })).toEqual([]);
    for (const kindCode of ['other', 'identity_document', 'connection_conditions', 'power_of_attorney']) {
      expect(siteSurveyDocumentIssues({ kindCode }), kindCode).toEqual([{ pointer: '/kindCode', code: 'requires_customer' }]);
    }
    expect(siteSurveyDocumentIssues({ kindCode: 'quote', confidentialityOverride: 'identity_data' })).toEqual([
      { pointer: '/confidentialityOverride', code: 'requires_customer' },
    ]);
    expect(siteSurveyDocumentIssues({ kindCode: 'other', confidentialityOverride: 'identity_data' })).toEqual([
      { pointer: '/kindCode', code: 'requires_customer' },
      { pointer: '/confidentialityOverride', code: 'requires_customer' },
    ]);
  });

  it('EVM-147 AC3 the change of a document of a survey: only the class is checked (the kind never changes)', () => {
    expect(siteSurveyDocumentIssues({ confidentialityOverride: 'identity_data' })).toEqual([
      { pointer: '/confidentialityOverride', code: 'requires_customer' },
    ]);
    expect(siteSurveyDocumentIssues({ confidentialityOverride: 'building_security' })).toEqual([]);
    expect(siteSurveyDocumentIssues({})).toEqual([]);
  });
});

describe('the rejected survey (EVM-147 AC4; ADR-0025 pt 5)', () => {
  it('EVM-147 AC4 a survey (no customer) that is cancelled is rejected; an open survey and a cancelled ordinary order are not', () => {
    expect(isRejectedSurvey({ customerId: null, status: 'cancelled' })).toBe(true);
    expect(isRejectedSurvey({ customerId: null, status: 'quoting' })).toBe(false);
    expect(isRejectedSurvey({ customerId: null, status: 'on_hold' })).toBe(false);
    expect(isRejectedSurvey({ customerId: CUSTOMER, status: 'cancelled' })).toBe(false);
    expect(awaitsCustomer({ customerId: null })).toBe(true);
  });
});

describe('the reminder names the documents (EVM-147 AC7)', () => {
  it.each([0, 2])(
    'EVM-147 AC7 with %i extensions the reminder says that the photos, the films and the documents go with the survey',
    (extensions) => {
      const { text } = siteSurveyReminderText({
        panelOrigin: 'https://panel.example.test',
        number: 'ZL-2026-0147',
        workOrderId: '0190a1b2-0000-7000-8000-0000000000a1',
        expiresAt: new Date('2027-02-14T08:00:00.000Z'),
        extensions,
      });
      expect(text.replace(/\s+/g, ' ')).toContain('zdjęcia, filmy, dokumenty i wpisy');
    },
  );
});
