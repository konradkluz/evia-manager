import { describe, expect, it } from 'vitest';
import { attentionPlan, type MutationType } from '../src/index.ts';

const WO = '0194c2a0-0000-7000-8000-000000000001';
const surveys = new Set([WO]);

describe('attention plan of a site survey (EVM-137 AC6, W10)', () => {
  const cases: [string, string][] = [
    ['validation_failed', 'validation_failed_survey'],
    ['id_conflict', 'id_conflict_survey'],
    ['feature_disabled', 'feature_disabled'],
    ['quota_exceeded', 'quota_exceeded_survey'],
    ['site_survey_limit_exceeded', 'site_survey_limit'],
    ['target_unavailable', 'survey_unavailable'],
    ['forbidden', 'survey_unavailable'],
    ['unknown', 'unknown_survey'],
    ['something_new', 'unknown_survey'],
  ];
  for (const [code, reason] of cases)
    it(`EVM-137 AC6: ${code} -> ${reason}, only "Usuń z telefonu"`, () => {
      expect(attentionPlan({ type: 'CreateSiteSurvey', lastCode: code })).toEqual({ reason, actions: ['discard'] });
    });

  it('EVM-137 AC6: no code at all is still only "Usuń z telefonu"', () => {
    expect(attentionPlan({ type: 'CreateSiteSurvey' })).toEqual({ reason: 'unknown_survey', actions: ['discard'] });
  });

  it('EVM-137 AC6 W10: what belongs to a deleted survey (a file, a note, a comment) gets the reason of its kind and only "Usuń z telefonu"', () => {
    const photo = { type: 'CreateMediaAsset' as MutationType, orderingKey: WO, payload: { mediaType: 'photo' } };
    const video = { type: 'CreateMediaAsset' as MutationType, orderingKey: WO, payload: { mediaType: 'video' } };
    for (const code of ['target_unavailable', 'forbidden']) {
      expect(attentionPlan({ ...photo, lastCode: code }, { surveyOrderIds: surveys })).toEqual({
        reason: 'survey_photo_unavailable',
        actions: ['discard'],
      });
      expect(attentionPlan({ ...video, lastCode: code }, { surveyOrderIds: surveys })).toEqual({
        reason: 'survey_video_unavailable',
        actions: ['discard'],
      });
      for (const type of ['CreateNote', 'CreateComment'] as const)
        expect(attentionPlan({ type, orderingKey: WO, lastCode: code }, { surveyOrderIds: surveys })).toEqual({
          reason: 'survey_entry_unavailable',
          actions: ['discard'],
        });
    }
  });

  it('EVM-137 AC6 W10: other rejections of the items of a survey never offer "Dodaj do innego zlecenia"', () => {
    for (const code of ['validation_failed', 'id_conflict', 'unknown', undefined])
      expect(attentionPlan({ type: 'CreateNote', orderingKey: WO, lastCode: code }, { surveyOrderIds: surveys }).actions).not.toContain(
        'retarget',
      );
  });

  it('EVM-137 AC6: an ordinary order is as before (no regression)', () => {
    const entry = { type: 'CreateNote' as MutationType, orderingKey: WO, lastCode: 'target_unavailable' };
    expect(attentionPlan(entry).actions).toEqual(['retarget', 'copy', 'discard']);
    expect(attentionPlan(entry, { surveyOrderIds: new Set() }).actions).toContain('retarget');
  });

  it('EVM-137 AC6: whatever the code, a survey offers only discard (property)', () => {
    for (const code of [...cases.map(([c]) => c), 'idempotency_mismatch', 'template_unavailable', ''])
      expect(attentionPlan({ type: 'CreateSiteSurvey', lastCode: code }).actions).toEqual(['discard']);
  });
});
