/**
 * Contract of the documents anchored to a site or a customer (EVM-050; SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-08): four operations, web only, three roles;
 * the anchor is a closed enum, the ids of the anchor are read-only and the creation body never carries them.
 */
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { zCreateDocumentBody } from '../src/zod.ts';

const READERS = { roles: ['administrator', 'editor', 'read_only'], channels: ['web'] };

describe('anchored documents contract (EVM-050)', () => {
  it('EVM-050 AC6 the lists and the downloads of site and customer documents are open to the three roles on the web channel only', () => {
    expect(AUTHZ_MANIFEST['listSiteDocuments']).toMatchObject({ method: 'get', path: '/api/v1/sites/{siteId}/documents', authz: READERS });
    expect(AUTHZ_MANIFEST['listCustomerDocuments']).toMatchObject({
      method: 'get',
      path: '/api/v1/customers/{customerId}/documents',
      authz: READERS,
    });
    expect(AUTHZ_MANIFEST['createSiteDocumentDownloadUrl']).toMatchObject({
      method: 'post',
      path: '/api/v1/sites/{siteId}/documents/{documentId}/download-url',
      authz: READERS,
    });
    expect(AUTHZ_MANIFEST['createCustomerDocumentDownloadUrl']).toMatchObject({
      method: 'post',
      path: '/api/v1/customers/{customerId}/documents/{documentId}/download-url',
      authz: READERS,
    });
  });

  const file = { fileName: 'a.pdf', contentType: 'application/pdf', declaredSize: 10, sha256: 'a'.repeat(64) };
  const base = { id: '0190f1a0-0000-7000-8000-000000000001', kindCode: 'building_documentation', title: 'T', file };

  it('EVM-050 AC1 the anchor is a closed enum', () => {
    for (const anchor of ['work_order', 'site', 'customer']) expect(zCreateDocumentBody.safeParse({ ...base, anchor }).success).toBe(true);
    expect(zCreateDocumentBody.safeParse({ ...base, anchor: 'user' }).success).toBe(false);
    expect(zCreateDocumentBody.safeParse(base).success).toBe(true);
  });
});
