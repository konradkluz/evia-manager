import { describe, expect, it } from 'vitest';
import { REDACTION_MARKER_PATTERN, redactionMarker } from '../../src/modules/timeline/domain/redaction-marker.ts';
import { entryEvent } from '../../src/modules/timeline/application/entry-event.ts';
import { TIMELINE_EVENT_TYPES } from '../../src/modules/timeline/events.ts';

describe('the marker of a redacted entry (EVM-040 AC2; SR-PRIV-03)', () => {
  it.each([
    ['2026-10-03T10:00:00.000Z', '03.10.2026'],
    // 22:30 UTC on 03.10 is 00:30 on 04.10 in Warsaw (CEST): the day is the business day, not the day in UTC
    ['2026-10-03T22:30:00.000Z', '04.10.2026'],
    // the turn of the year in Warsaw (CET, UTC+1)
    ['2026-12-31T23:30:00.000Z', '01.01.2027'],
    ['2027-03-28T00:30:00.000Z', '28.03.2027'],
  ])('EVM-040 AC2 %s is "Treść usunięta przez administratora %s."', (instant, day) => {
    const marker = redactionMarker(new Date(instant));
    expect(marker).toBe(`Treść usunięta przez administratora ${day}.`);
    expect(REDACTION_MARKER_PATTERN.test(marker)).toBe(true);
  });

  it('EVM-040 AC2 the pattern is anchored: a text around the marker, a missing dot and another shape of the date are not a marker', () => {
    for (const text of [
      'x Treść usunięta przez administratora 03.10.2026.',
      'Treść usunięta przez administratora 03.10.2026',
      'Treść usunięta przez administratora 3.10.2026.',
    ]) {
      expect(REDACTION_MARKER_PATTERN.test(text)).toBe(false);
    }
  });
});

describe('the audit event of an entry (EVM-040 AC4; SR-LOG-03)', () => {
  it('EVM-040 AC4 the event holds the action, the actor, the entry and the outcome - and nothing else', () => {
    const event = entryEvent('timeline_entry.redacted', { userId: 'u1' }, 'e1', 'failed');
    expect(event).toEqual({
      type: 'timeline_entry.redacted',
      actor: { type: 'user', userId: 'u1' },
      outcome: 'failed',
      objectType: 'timeline_entry',
      objectId: 'e1',
    });
    expect(TIMELINE_EVENT_TYPES).toEqual([
      'timeline_entry.created',
      'timeline_entry.deleted',
      'timeline_entry.restored',
      'timeline_entry.redacted',
    ]);
  });
});
