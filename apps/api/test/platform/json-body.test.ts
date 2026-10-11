import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { jsonBody, SESSION_BODY_LIMIT, type BodyPolicy } from '../../src/platform/http/json-body.ts';
import { resolveAuthentication, type Principal } from '../../src/platform/http/principal.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';

const principal = {
  userId: 'u',
  role: 'editor',
  channel: 'web',
  sessionId: 's',
  state: 'active',
  csrfToken: 't',
  passkeyAuthenticatedAt: null,
  lastSeenAt: new Date(0),
  idleExpiresAt: new Date(0),
  absoluteExpiresAt: new Date(0),
} satisfies Principal;

const server = (policy: BodyPolicy) => {
  const app = express();
  app.use(
    resolveAuthentication(
      {
        resolve: (req) =>
          Promise.resolve(req.headers['x-session'] === undefined ? { principal: null, reason: 'anonymous' as const } : { principal }),
      },
      createLogger({ level: 'fatal' }),
    ),
  );
  app.use(jsonBody(policy));
  const echo = (req: express.Request, res: express.Response) => {
    res.json({ parsed: req.body !== undefined });
  };
  app.post('/tight', echo);
  app.post('/wide', echo);
  return request(app);
};

const policy: BodyPolicy = {
  isPublicBodyOperation: () => false,
  sessionBodyLimit: (method, path) => (method === 'POST' && path === '/tight' ? '1kb' : undefined),
};

describe('the limit of a body per route (EVM-037 K13; SR-API-02)', () => {
  it('EVM-037 K13 a route with its own limit refuses a body over it with 413; another route of the session keeps 1 MB', async () => {
    const api = server(policy);
    const big = JSON.stringify({ text: 'x'.repeat(2000) });
    expect((await api.post('/tight').set('x-session', '1').set('Content-Type', 'application/json').send(big)).status).toBe(413);
    expect((await api.post('/tight').set('x-session', '1').set('Content-Type', 'application/json').send('{"a":1}')).status).toBe(200);
    expect((await api.post('/wide').set('x-session', '1').set('Content-Type', 'application/json').send(big)).status).toBe(200);
    expect(SESSION_BODY_LIMIT).toBe('1mb');
  });

  it('EVM-037 K13 a policy without a per-route limit keeps the limit of a session for every route', async () => {
    const api = server({ isPublicBodyOperation: () => false });
    const big = JSON.stringify({ text: 'x'.repeat(2000) });
    expect((await api.post('/tight').set('x-session', '1').set('Content-Type', 'application/json').send(big)).status).toBe(200);
  });

  it('EVM-037 K13 an anonymous body is not parsed at all (the guard answers 401 for it), whatever the route limit', async () => {
    const api = server(policy);
    const response = await api.post('/tight').set('Content-Type', 'application/json').send('{"a":1}');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ parsed: false });
  });
});
