import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zAuditAction,
  zAuditReasonCode,
  zExtendSiteSurveyHeaders,
  zExtendSiteSurveyPath,
  zExtendSiteSurveyRequest,
  zSyncMutationResult,
} from '../src/zod.ts';

/**
 * The extension of a site survey and the limit of open surveys in the contract (EVM-140; ADR-0024 pt 9, 10; SR-AUTHZ-05, SR-PRIV-01). Synthetic identifiers only.
 */
const ORDER = '0198b0a0-0000-4000-8000-000000000140';
const KEY = '0198b0a0-0000-7000-8000-000000000140';
const REASONS = ['awaiting_client_decision', 'awaiting_community_decision', 'second_visit_needed'];

interface Answer {
  readonly $ref?: string;
  readonly content?: Record<string, { readonly example?: { readonly code?: string } }>;
}
interface BundledOperation {
  readonly description?: string;
  readonly responses: Record<string, Answer>;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
  components: { responses: Record<string, Answer> };
};
const PATH = '/api/v1/work-orders/{workOrderId}/site-survey/extensions';
const extension = bundled.paths[PATH]?.['post'];
const problemOf = (operation: BundledOperation | undefined, status: string): string | undefined => {
  const ref = operation?.responses[status]?.$ref?.split('/').pop() ?? '';
  return bundled.components.responses[ref]?.content?.['application/problem+json']?.example?.code;
};

describe('the extension of a site survey in the contract (EVM-140 AC2, AC3)', () => {
  it('EVM-140 AC3 extendSiteSurvey is for the Administrator and the Editor on the web channel only, with audit', () => {
    expect(AUTHZ_MANIFEST['extendSiteSurvey']).toEqual({
      method: 'post',
      path: PATH,
      query: [],
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-140 AC2 the request is a reason of the closed list and a version; anything else is refused', () => {
    for (const reason of REASONS) expect(zExtendSiteSurveyRequest.safeParse({ reason, version: 3 }).success, reason).toBe(true);
    for (const body of [
      { version: 3 },
      { reason: 'awaiting_client_decision' },
      { reason: 'free text', version: 3 },
      { reason: '', version: 3 },
      { reason: 'second_visit_needed', version: 0 },
      { reason: 'second_visit_needed', version: 1.5 },
    ]) {
      expect(zExtendSiteSurveyRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(zExtendSiteSurveyPath.safeParse({ workOrderId: ORDER }).success).toBe(true);
  });

  it('EVM-140 AC2 the version is in the body (no If-Match) and the Idempotency-Key is an optional UUIDv7', () => {
    expect(JSON.stringify(extension)).not.toContain('IfMatchHeader');
    expect(zExtendSiteSurveyHeaders.safeParse({}).success).toBe(true);
    expect(zExtendSiteSurveyHeaders.safeParse({ 'Idempotency-Key': KEY }).success).toBe(true);
    expect(zExtendSiteSurveyHeaders.safeParse({ 'Idempotency-Key': 'x' }).success).toBe(false);
  });

  it('EVM-140 AC3 the answers declare 409 extension_limit_reached and 412 version_conflict; the description fixes the order of the checks', () => {
    expect(problemOf(extension, '409')).toBe('extension_limit_reached');
    expect(problemOf(extension, '412')).toBe('version_conflict');
    for (const status of ['200', '400', '401', '403', '404', '413', '415', '422', '429'])
      expect(extension?.responses[status], status).toBeDefined();
    const text = extension?.description ?? '';
    for (const word of [
      'extension_limit_reached',
      'invalid_state_transition',
      '412 version_conflict',
      '270 dni',
      'work_order.site_survey_extended',
    ]) {
      expect(text, word).toContain(word);
    }
  });

  it('EVM-140 AC2 the audit trail knows the action and the three reason codes', () => {
    expect(zAuditAction.safeParse('work_order.site_survey_extended').success).toBe(true);
    for (const reason of REASONS) expect(zAuditReasonCode.safeParse(reason).success, reason).toBe(true);
  });
});

describe('the limit of open site surveys in the contract (EVM-140 AC4)', () => {
  it('EVM-140 AC4 the panel declares 409 site_survey_limit_exceeded on createSiteSurvey', () => {
    expect(problemOf(bundled.paths['/api/v1/site-surveys']?.['post'], '409')).toBe('site_survey_limit_exceeded');
  });

  it('EVM-140 AC4 a mutation of the phone may be rejected with site_survey_limit_exceeded', () => {
    expect(zSyncMutationResult.safeParse({ mutationId: KEY, outcome: 'rejected', code: 'site_survey_limit_exceeded' }).success).toBe(true);
  });
});
