import { afterEach, describe, expect, it } from 'vitest';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { enrolledAccount, signIn } from '../support/login-flows.ts';
import { MOBILE, signedInPhone } from '../support/mobile-flows.ts';
import { totpAccount } from '../support/totp-flows.ts';

/**
 * The switch of the site survey is readable by the app and the panel (EVM-135 AC3; ADR-0024 pt 10): `SITE_SURVEYS_ENABLED` reaches the configuration of the
 * client (`features.siteSurveys`) and the current session of the panel; absent, it is off. Synthetic accounts only.
 */
let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function read(env: Record<string, string | undefined>): Promise<{ panel: unknown; phone: unknown }> {
  current = await createIdentityApp({ env });
  const account = await enrolledAccount(current, { role: 'editor' });
  const panel = current.panel();
  expect((await signIn(panel, account)).status).toBe(200);
  const session = await panel.get(PATHS.session);
  expect(session.status).toBe(200);
  const phone = await signedInPhone(current, await totpAccount(current, { role: 'editor' }));
  const config = await phone.get(MOBILE.config, phone.authorised());
  expect(config.status).toBe(200);
  return { panel: (session.body as { features: unknown }).features, phone: (config.body as { features: unknown }).features };
}

describe('the switch of the site survey for the app and the panel (EVM-135 AC3)', () => {
  it('EVM-135 AC3 SITE_SURVEYS_ENABLED=true: the session of the panel and the configuration of the client say siteSurveys true', async () => {
    expect(await read({ SITE_SURVEYS_ENABLED: 'true' })).toEqual({ panel: { siteSurveys: true }, phone: { siteSurveys: true } });
  });

  it('EVM-135 AC3 absent or false: both say siteSurveys false (deny by default)', async () => {
    expect(await read({})).toEqual({ panel: { siteSurveys: false }, phone: { siteSurveys: false } });
    await current?.close();
    expect(await read({ SITE_SURVEYS_ENABLED: 'false' })).toEqual({ panel: { siteSurveys: false }, phone: { siteSurveys: false } });
  });
});
