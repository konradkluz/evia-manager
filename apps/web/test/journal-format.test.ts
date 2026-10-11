import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { describeJournalFailure } from '../src/work-orders/use-journal.ts';
import { noteCategoryLabel } from '../src/i18n/journal-labels.ts';
import { ENTRY_BODY_MAX, EMPTY_DRAFT, codePointLength, dropDraft, loadDraft, storeDraft } from '../src/work-orders/journal-draft.ts';
import {
  dayKeyOf,
  formatEntryDate,
  formatFullDateTime,
  formatTimeOfDay,
  groupByDay,
  previousDayKey,
  relationOf,
} from '../src/work-orders/journal-format.ts';
import { clearDrafts, saveDraft } from '../src/session/draft-store.ts';

afterEach(() => {
  clearDrafts();
});

describe('days and times of the journal (EVM-037 AC6; styleguide § 6.3)', () => {
  it('EVM-037 AC6 the day is the calendar day of Europe/Warsaw, also around midnight and the change of the clock', () => {
    expect(dayKeyOf('2026-10-11T21:59:59.000Z')).toBe('2026-10-11');
    expect(dayKeyOf('2026-10-11T22:00:00.000Z')).toBe('2026-10-12');
    // winter time: 23:00 UTC is already the next day
    expect(dayKeyOf('2026-12-31T22:59:00.000Z')).toBe('2026-12-31');
    expect(dayKeyOf('2026-12-31T23:00:00.000Z')).toBe('2027-01-01');
    expect(dayKeyOf('not a date')).toBe('not a date');
  });

  it('EVM-037 AC6 the day before is counted on the calendar, across months and years', () => {
    expect(previousDayKey('2026-10-11')).toBe('2026-10-10');
    expect(previousDayKey('2026-10-01')).toBe('2026-09-30');
    expect(previousDayKey('2027-01-01')).toBe('2026-12-31');
    expect(previousDayKey('2028-03-01')).toBe('2028-02-29');
    expect(previousDayKey('nonsense')).toBe('nonsense');
  });

  it('EVM-037 AC6 a day is "today", "yesterday" or another day of the business zone', () => {
    const now = Date.parse('2026-10-11T12:00:00.000Z');
    expect(relationOf('2026-10-11', now)).toBe('today');
    expect(relationOf('2026-10-10', now)).toBe('yesterday');
    expect(relationOf('2026-10-02', now)).toBe('other');
    expect(relationOf('2026-10-12', now)).toBe('other');
  });

  it('EVM-037 AC6 dates read DD.MM.YYYY and times H:MM in the business zone', () => {
    expect(formatEntryDate('2026-10-02T08:00:00.000Z')).toBe('02.10.2026');
    expect(formatTimeOfDay('2026-10-11T07:41:00.000Z')).toBe('9:41');
    expect(formatTimeOfDay('2026-10-11T12:10:00.000Z')).toBe('14:10');
    expect(formatFullDateTime('2026-10-11T12:10:00.000Z')).toBe('11.10.2026 14:10');
    expect(formatEntryDate('garbage')).toBe('garbage');
    expect(formatTimeOfDay('garbage')).toBe('garbage');
  });

  it('EVM-037 AC6 entries are grouped by day in the order given, so the server order is kept', () => {
    const groups = groupByDay([
      { createdAt: '2026-10-11T12:00:00.000Z', id: 'a' },
      { createdAt: '2026-10-11T08:00:00.000Z', id: 'b' },
      { createdAt: '2026-10-10T20:00:00.000Z', id: 'c' },
    ]);
    expect(groups.map((group) => [group.day, group.items.map((item) => item.id)])).toEqual([
      ['2026-10-11', ['a', 'b']],
      ['2026-10-10', ['c']],
    ]);
    expect(groupByDay([])).toEqual([]);
  });
});

describe('draft of the journal (EVM-037 AC8; SR-WEB-05)', () => {
  it('EVM-037 AC8 characters are counted as the server counts them: code points, not UTF-16 units', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('😀😀')).toBe(2);
    expect(codePointLength('zażółć')).toBe(6);
    expect(ENTRY_BODY_MAX).toBe(10_000);
  });

  it('EVM-037 AC8 a draft is kept per order and per person, in memory, and dropped when nothing is typed', () => {
    const draft = { kind: 'comment', category: 'meeting', stageId: 'stage', body: 'Treść', savedAt: 5 } as const;
    storeDraft('user-1', 'order-1', draft);
    expect(loadDraft('user-1', 'order-1')).toEqual(draft);
    expect(loadDraft('user-1', 'order-2')).toEqual(EMPTY_DRAFT);
    expect(loadDraft('user-2', 'order-1')).toEqual(EMPTY_DRAFT);
    expect(loadDraft(undefined, 'order-1')).toEqual(EMPTY_DRAFT);
    storeDraft('user-1', 'order-1', { ...draft, body: '' });
    expect(loadDraft('user-1', 'order-1')).toEqual(EMPTY_DRAFT);
    storeDraft('user-1', 'order-1', draft);
    dropDraft('order-1');
    expect(loadDraft('user-1', 'order-1')).toEqual(EMPTY_DRAFT);
    storeDraft(undefined, 'order-1', draft);
    expect(loadDraft('user-1', 'order-1')).toEqual(EMPTY_DRAFT);
  });

  it('EVM-037 AC8 a damaged or foreign record is ignored, never trusted', () => {
    saveDraft('user-1', 'journal:order-1', '{not json');
    expect(loadDraft('user-1', 'order-1')).toEqual(EMPTY_DRAFT);
    saveDraft('user-1', 'journal:order-1', JSON.stringify({ kind: 'event', category: 'x', stageId: 3, body: 7, savedAt: 'now' }));
    expect(loadDraft('user-1', 'order-1')).toEqual(EMPTY_DRAFT);
    saveDraft('user-1', 'journal:order-1', JSON.stringify({ kind: 'note', category: 'meeting', stageId: 's', body: 'x', savedAt: 1 }));
    expect(loadDraft('user-1', 'order-1')).toMatchObject({ category: 'meeting', body: 'x' });
  });

  it('EVM-037 AC1 a category the panel does not know has no label (P-12), a known one has', () => {
    expect(noteCategoryLabel('phone_call')).toBe('Rozmowa telefoniczna');
    expect(noteCategoryLabel('site_visit')).toBe('Wizyta na miejscu');
    expect(noteCategoryLabel('toString')).toBeUndefined();
    expect(noteCategoryLabel('future_category')).toBeUndefined();
  });
});

describe('why an entry was not saved (EVM-037 AC5, AC7, AC8)', () => {
  const invalid = (pointer: string, code: string) => new ApiError(400, { code: 'validation_failed', errors: [{ pointer, code }] });

  it('EVM-037 AC8 the fields of the API are told by pointer and code, never by a value', () => {
    expect(describeJournalFailure(invalid('/body', 'too_long'))).toEqual({ kind: 'tooLong' });
    expect(describeJournalFailure(invalid('/body', 'required'))).toEqual({ kind: 'required' });
    expect(describeJournalFailure(invalid('/body', 'invalid_characters'))).toEqual({ kind: 'invalidCharacters' });
    expect(describeJournalFailure(invalid('/procedureStageId', 'unknown_stage'))).toEqual({ kind: 'stage' });
    expect(describeJournalFailure(invalid('/supersedesEntryId', 'unknown_entry'))).toEqual({ kind: 'entryGone' });
  });

  it('EVM-037 AC3 a missing order, a corrected entry and everything else have their own words; no answer is a failure of the network', () => {
    expect(describeJournalFailure(new ApiError(404, { code: 'not_found' }))).toEqual({ kind: 'gone' });
    expect(describeJournalFailure(new ApiError(409, { code: 'entry_superseded' }))).toEqual({ kind: 'superseded' });
    expect(describeJournalFailure(new ApiError(0, undefined))).toEqual({ kind: 'network' });
    expect(describeJournalFailure(new ApiError(403, { code: 'forbidden' }))).toEqual({ kind: 'forbidden' });
    expect(describeJournalFailure(new ApiError(400, { code: 'validation_failed', errors: [] }))).toEqual({
      kind: 'server',
      code: 'validation_failed',
    });
    expect(describeJournalFailure(new Error('boom'))).toEqual({ kind: 'network' });
  });
});
