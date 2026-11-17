import { describe, expect, it } from 'vitest';
import {
  SITE_SURVEY_REMINDER_SUBJECT_PREFIX,
  siteSurveyReminderText,
  type SiteSurveyReminderInput,
} from '../../src/modules/work-orders/domain/site-survey-reminder.ts';

const input = (over: Partial<SiteSurveyReminderInput> = {}): SiteSurveyReminderInput => ({
  panelOrigin: 'https://panel.example.test',
  number: 'ZL-2026-0049',
  workOrderId: '0190a1b2-0000-7000-8000-0000000000a1',
  expiresAt: new Date('2027-02-14T08:00:00.000Z'),
  extensions: 0,
  ...over,
});

describe('the text of the reminder about the deletion of a site survey (EVM-140 AC1)', () => {
  it.each([0, 1])(
    'EVM-140 AC1 with %i extensions the text offers the extension and carries the number, the date and the link',
    (extensions) => {
      const { subject, text } = siteSurveyReminderText(input({ extensions }));
      expect(subject).toBe(`${SITE_SURVEY_REMINDER_SUBJECT_PREFIX} ZL-2026-0049 zostanie usunięta`);
      expect(text).toContain('wizja lokalna ZL-2026-0049 zostanie usunięta dnia 14.02.2027.');
      expect(text).toContain('Przypisz klienta, przedłuż albo odrzuć.');
      expect(text).toContain('Wizję możesz przedłużyć najwyżej dwa razy');
      expect(text).not.toContain('nie można jej przedłużyć');
      expect(text).toContain('https://panel.example.test/work-orders/0190a1b2-0000-7000-8000-0000000000a1');
    },
  );

  it('EVM-140 AC1 at the limit of two extensions the text no longer offers the extension and says so', () => {
    const { text } = siteSurveyReminderText(input({ extensions: 2 }));
    expect(text).toContain('Przypisz klienta albo odrzuć.');
    expect(text).not.toContain('przedłuż albo');
    expect(text).toContain('Ta wizja była już dwukrotnie przedłużona i nie można jej przedłużyć');
    expect(text).not.toContain('Wizję możesz przedłużyć');
    expect(text).toContain('tego nie da się cofnąć.');
  });

  it('EVM-140 AC1 the date is the day in the business zone (late evening UTC is the next day in Warsaw)', () => {
    const { text } = siteSurveyReminderText(input({ expiresAt: new Date('2027-02-14T23:30:00.000Z') }));
    expect(text).toContain('dnia 15.02.2027.');
  });
});
