import { zVersion } from '@evia/contracts/zod';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ANONYMOUS, SESSION_RESOLVER } from '../../src/platform/http/principal.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { principal, resolverOf } from '../support/principals.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

/** Synthetic release values (never a real commit of the repository). */
const COMMIT = 'a1'.repeat(20);
const MANIFEST_SHA256 = 'b2'.repeat(32);
const RELEASE = { EVIA_RELEASE_COMMIT: COMMIT, EVIA_RELEASE_MANIFEST_SHA256: MANIFEST_SHA256 };

const signedIn = (role: 'administrator' | 'editor' | 'read_only') => resolverOf({ principal: principal({ role }) });

describe('GET /api/version (EVM-007 AC4, AC6; SR-API-12)', () => {
  it('EVM-007 AC4 version returns the commit of the image and the hash of the release manifest, nothing else, matching the contract', async () => {
    current = await createTestApp({ env: RELEASE });
    const response = await request(current.app.getHttpServer()).get('/api/version').expect(200);
    expect(response.body).toEqual({ commit: COMMIT, manifestSha256: MANIFEST_SHA256 });
    expect(zVersion.parse(response.body)).toEqual(response.body);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('EVM-007 AC4 outside the deployment channel (no release settings, an image built without the commit) both values are null', async () => {
    for (const env of [{}, { EVIA_RELEASE_COMMIT: '', EVIA_RELEASE_MANIFEST_SHA256: '' }]) {
      current = await createTestApp({ env });
      const response = await request(current.app.getHttpServer()).get('/api/version').expect(200);
      expect(response.body).toEqual({ commit: null, manifestSha256: null });
      expect(zVersion.parse(response.body)).toEqual(response.body);
      await current.close();
      current = undefined;
    }
  });

  // Role matrix: a public technical operation — the same answer for everyone, no session is needed or read; there is no object of
  // another user to reach (no IDOR surface): the answer is the same for every caller.
  for (const [name, resolver] of [
    ['anonymous', resolverOf(ANONYMOUS)],
    ['administrator', signedIn('administrator')],
    ['editor', signedIn('editor')],
    ['read-only', signedIn('read_only')],
  ] as const) {
    it(`EVM-007 AC4 role matrix: ${name} gets the same public answer`, async () => {
      current = await createTestApp({
        env: RELEASE,
        configure: (builder) => builder.overrideProvider(SESSION_RESOLVER).useValue(resolver),
      });
      const response = await request(current.app.getHttpServer()).get('/api/version').expect(200);
      expect(response.body).toEqual({ commit: COMMIT, manifestSha256: MANIFEST_SHA256 });
    });
  }

  it('EVM-007 AC4 version accepts only GET (HEAD like GET); a mutation is not routed', async () => {
    current = await createTestApp({ env: RELEASE });
    await request(current.app.getHttpServer()).head('/api/version').expect(200);
    const post = await request(current.app.getHttpServer()).post('/api/version').send({});
    expect([401, 403, 404]).toContain(post.status);
  });
});
