import { describe, expect, it } from 'vitest';
import { businessDate } from '../../src/platform/clock/business-date.ts';
import { STAGE_STATUSES, isOpenStage, isOverdue, progressOf, type StageStatus } from '../../src/modules/procedures/domain/stage-rules.ts';

const stage = (status: StageStatus, dueDate: string | null) => ({ status, dueDate });

describe('overdue stages (EVM-031 AC3; domain-model → "Daty", Europe/Warsaw)', () => {
  it('EVM-031 AC3 a stage due 2026-10-02 is overdue on 2026-10-03', () => {
    expect(isOverdue(stage('todo', '2026-10-02'), '2026-10-03')).toBe(true);
  });

  it('EVM-031 AC3 a stage due today is not overdue yet, one due tomorrow neither, and one without a due date never', () => {
    expect(isOverdue(stage('todo', '2026-10-03'), '2026-10-03')).toBe(false);
    expect(isOverdue(stage('todo', '2026-10-04'), '2026-10-03')).toBe(false);
    expect(isOverdue(stage('todo', null), '2026-10-03')).toBe(false);
  });

  it('EVM-031 AC3 a finished stage (done, not applicable) is never overdue; an open or a blocked one is', () => {
    for (const status of STAGE_STATUSES) {
      const finished = status === 'done' || status === 'not_applicable';
      expect(isOverdue(stage(status, '2026-10-02'), '2026-10-03'), status).toBe(!finished);
    }
  });

  it('EVM-031 AC3 "today" is the day in Europe/Warsaw, not in UTC: 22:30 UTC on 2026-10-02 is already 2026-10-03 in Warsaw (summer time, UTC+2)', () => {
    const lateEvening = new Date('2026-10-02T22:30:00Z');
    expect(businessDate(lateEvening)).toBe('2026-10-03');
    expect(isOverdue(stage('todo', '2026-10-02'), businessDate(lateEvening))).toBe(true);
    const earlier = new Date('2026-10-02T21:59:59Z');
    expect(businessDate(earlier)).toBe('2026-10-02');
    expect(isOverdue(stage('todo', '2026-10-02'), businessDate(earlier))).toBe(false);
  });

  it('EVM-031 AC3 the boundary follows the change to winter time (UTC+1 from 2026-10-25): 22:59 UTC is still the 25th, 23:00 UTC the 26th', () => {
    expect(businessDate(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(businessDate(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
});

describe('open stages and progress (EVM-031 AC2, AC4; styleguide § 3.23)', () => {
  it('EVM-031 AC4 open are todo, in_progress and waiting; blocked, done and not applicable are not', () => {
    expect(STAGE_STATUSES.filter(isOpenStage)).toEqual(['todo', 'in_progress', 'waiting']);
  });

  it('EVM-031 AC2 the progress is the stages done of the stages without "not applicable": "3 of 7"', () => {
    const stages = [
      ...Array.from({ length: 3 }, () => ({ status: 'done' as const })),
      ...Array.from({ length: 4 }, () => ({ status: 'todo' as const })),
      { status: 'not_applicable' as const },
    ];
    expect(progressOf(stages)).toEqual({ done: 3, total: 7 });
  });

  it('EVM-031 AC2 all done is "n of n"; no stages or only "not applicable" is 0 of 0', () => {
    expect(progressOf([{ status: 'done' }, { status: 'done' }])).toEqual({ done: 2, total: 2 });
    expect(progressOf([])).toEqual({ done: 0, total: 0 });
    expect(progressOf([{ status: 'not_applicable' }])).toEqual({ done: 0, total: 0 });
  });
});
