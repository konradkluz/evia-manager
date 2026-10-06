import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../../src/app.ts';
import { loadConfig } from '../../src/platform/config/config.ts';
import { requestContextMixin } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { LogCapture, PANEL_ORIGIN, validEnv } from '../support/app.ts';

// The process wiring of src/main.ts (createApiApp): trusted proxies and background jobs (EVM-016 AC2, AC5).
let current: NestExpressApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const build = async (env: Record<string, string>, alertPollMs?: number) => {
  const logs = new LogCapture();
  const logger = createLogger({ level: 'info', destination: logs, mixin: requestContextMixin });
  current = await createApiApp(loadConfig(validEnv(env)), logger, alertPollMs === undefined ? {} : { alertPollMs });
  return { logs, server: request(current.getHttpServer()) };
};

const post = (server: ReturnType<typeof request>, forwardedFor: string) =>
  server
    .post('/api/v1/auth/activation/password')
    .set('Origin', PANEL_ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', forwardedFor)
    .send(JSON.stringify({ token: 'short', password: 'x' }));

describe('the API process wiring used by src/main.ts (EVM-016)', () => {
  it('EVM-016 AC5 TRUSTED_PROXIES reaches the HTTP adapter: the forwarded client address is the one counted', async () => {
    const { server } = await build({ TRUSTED_PROXIES: '127.0.0.1,::1,::ffff:127.0.0.1' });
    for (let attempt = 1; attempt <= 25; attempt += 1) expect((await post(server, `203.0.113.${attempt}`)).status).toBe(400);
  });

  it('EVM-016 AC5 without TRUSTED_PROXIES the forwarded address is ignored and the limit applies to the peer', async () => {
    const { server } = await build({});
    let last = 0;
    for (let attempt = 1; attempt <= 25; attempt += 1) last = (await post(server, `203.0.113.${attempt}`)).status;
    expect(last).toBe(429);
  });

  it('EVM-016 AC2 the alert outbox is polled by the running API process without anyone calling the emitter', async () => {
    const { logs } = await build({}, 10);
    await expect
      .poll(() => logs.entries.some((entry) => entry['msg'] === 'security alert emission failed; will retry'), { timeout: 5000 })
      .toBe(true);
  });

  it('EVM-016 AC2 the poll stops when the application shuts down', async () => {
    const { logs } = await build({}, 10);
    await expect.poll(() => logs.lines.length, { timeout: 5000 }).toBeGreaterThan(0);
    await current?.close();
    current = undefined;
    const settled = logs.lines.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(logs.lines.length).toBe(settled);
  });
});
