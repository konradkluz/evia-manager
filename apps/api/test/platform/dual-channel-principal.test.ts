import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { dualChannelPrincipalOf, resolveAuthentication, type Authentication, type Principal } from '../../src/platform/http/principal.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';

const base = {
  role: 'editor',
  state: 'active',
  csrfToken: 't',
  passkeyAuthenticatedAt: null,
  totpAuthenticatedAt: null,
  lastSeenAt: new Date(0),
  idleExpiresAt: new Date(0),
  absoluteExpiresAt: new Date(0),
} as const;
const panel: Principal = { ...base, userId: 'panel-user', channel: 'web', sessionId: 'panel-session' };
const phone: Principal = { ...base, userId: 'phone-user', channel: 'mobile', sessionId: 'phone-session', deviceId: 'phone-device' };
const phoneCookie: Principal = {
  ...base,
  userId: 'phone-user',
  channel: 'mobile',
  sessionId: 'cookie-of-a-phone',
  deviceId: 'phone-device',
};

const anonymous: Authentication = { principal: null, reason: 'anonymous' };

function api() {
  const app = express();
  app.use(
    resolveAuthentication(
      {
        resolve: (req) =>
          Promise.resolve(
            req.headers['x-cookie'] === 'panel'
              ? { principal: panel }
              : req.headers['x-cookie'] === 'phone'
                ? { principal: phoneCookie }
                : anonymous,
          ),
        resolveBearer: (req) => Promise.resolve(req.headers['x-bearer'] === undefined ? anonymous : { principal: phone }),
      },
      createLogger({ level: 'fatal' }),
    ),
  );
  app.get('/who', (req, res) => {
    res.json({ session: dualChannelPrincipalOf(req)?.sessionId ?? null });
  });
  return request(app);
}

describe('the principal of an operation open to both channels (EVM-131 AC2; SR-AUTHZ-12)', () => {
  it('EVM-131 AC2 the session of the panel wins when both credentials are there; the token is the principal when the cookie holds none', async () => {
    expect((await api().get('/who').set('X-Cookie', 'panel').set('X-Bearer', '1')).body).toEqual({ session: 'panel-session' });
    expect((await api().get('/who').set('X-Cookie', 'panel')).body).toEqual({ session: 'panel-session' });
    expect((await api().get('/who').set('X-Bearer', '1')).body).toEqual({ session: 'phone-session' });
  });

  it('EVM-131 AC2 a session of the phone in a cookie is never the principal of the panel: the token (or nobody) is', async () => {
    expect((await api().get('/who').set('X-Cookie', 'phone')).body).toEqual({ session: null });
    expect((await api().get('/who').set('X-Cookie', 'phone').set('X-Bearer', '1')).body).toEqual({ session: 'phone-session' });
    expect((await api().get('/who')).body).toEqual({ session: null });
  });
});
