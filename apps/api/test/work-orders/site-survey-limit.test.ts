import { describe, expect, it } from 'vitest';
import {
  SITE_SURVEY_LIMIT_PER_CREATOR,
  SITE_SURVEY_LIMIT_TOTAL,
  surveyLimitExceeded,
} from '../../src/modules/work-orders/domain/site-survey.ts';

describe('the limit of open site surveys (EVM-140 AC4; ADR-0024 pt 10)', () => {
  it('EVM-140 AC4 the limits are 20 per creator and 100 in all', () => {
    expect([SITE_SURVEY_LIMIT_PER_CREATOR, SITE_SURVEY_LIMIT_TOTAL]).toEqual([20, 100]);
  });

  it('EVM-140 AC4 the boundary of the creator: the 20th is allowed (19 open before), the 21st is not (20 open before)', () => {
    expect(surveyLimitExceeded({ ofCreator: 19, total: 19 })).toBe(false);
    expect(surveyLimitExceeded({ ofCreator: 20, total: 20 })).toBe(true);
  });

  it('EVM-140 AC4 the boundary of the total: the 100th is allowed (99 open before), the 101st is not, whoever the creator is', () => {
    expect(surveyLimitExceeded({ ofCreator: 0, total: 99 })).toBe(false);
    expect(surveyLimitExceeded({ ofCreator: 0, total: 100 })).toBe(true);
  });
});
