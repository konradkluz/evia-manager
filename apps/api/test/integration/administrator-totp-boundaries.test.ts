/**
 * Boundaries of K1 for an Administrator who signs in with a code of the app (EVM-134 AC4, AC5; ADR-0023, SR-SESS-08, SR-AUTH-05, TM-90) — added by the
 * independent QA: the time step is ONE budget for the sign-in, the re-authentication of the account and the step-up (a code spent by one is refused by the
 * others), the re-authentication does not open the window of step-up operations, and a step older than the last used one is refused though it is still
 * inside the tolerance of ±1 step. Synthetic data only.
 */
import type { Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { reauthWithCode } from '../support/account-flows.ts';
import { adopt } from '../support/login-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { STEP_UP } from '../support/step-up-flows.ts';
import {
  codeNow,
  nextStep,
  SECOND_STEP,
  sendLoginTotp,
  signInWithTotp,
  startLogin,
  totpAccount,
  type TotpAccount,
} from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const codeOf = (response: Response): string | undefined => (response.body as { code?: string }).code;
const sendStepUp = (panel: PanelClient, code: string): Promise<Response> =>
  Promise.resolve(panel.post(SECOND_STEP.stepUp, { method: 'totp', code }));

/** An Administrator whose only method is a code, signed in with the code of the CURRENT step; returns that code. */
async function signedIn(): Promise<{ account: TotpAccount; panel: PanelClient; loginCode: string }> {
  const account = await totpAccount(current, { role: 'administrator' });
  const loginCode = codeNow(current, account.secret);
  const panel = current.panel();
  const response = await sendLoginTotp(panel, await startLogin(panel, account), loginCode);
  expect(response.status).toBe(200);
  adopt(panel, response);
  return { account, panel, loginCode };
}

describe('K1 boundaries of the Administrator with a code (EVM-134 AC4)', () => {
  it('EVM-134 AC4 K1 the re-authentication of the account shares the time step and opens no window of step-up: the code of the sign-in is refused there, a new one gives only the mark', async () => {
    const { account, panel, loginCode } = await signedIn();
    expect(loginCode).toBe(codeNow(current, account.secret));

    const replayed = await reauthWithCode(panel, 'second_step_change', loginCode, account.password);
    expect(replayed.status).toBe(401);
    expect(codeOf(replayed)).toBe('reauthentication_failed');

    nextStep(current);
    const spent = codeNow(current, account.secret);
    expect((await reauthWithCode(panel, 'second_step_change', spent, account.password)).status).toBe(204);
    // the proof of the account is a MARK for one operation of the account — it is no step-up: the first sensitive operation still asks for one
    const refused = await panel.get(STEP_UP.audit);
    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('step_up_required');
    // the step of the re-authentication is spent for the step-up as well; the next step opens the window
    const again = await sendStepUp(panel, spent);
    expect(again.status).toBe(401);
    expect(codeOf(again)).toBe('totp_failed');
    nextStep(current);
    const fresh = await sendStepUp(panel, codeNow(current, account.secret));
    expect(fresh.status).toBe(200);
    adopt(panel, fresh);
    expect((await panel.get(STEP_UP.audit)).status).toBe(200);
  });

  it('EVM-134 AC4 K1 the code spent by the step-up is no sign-in either: a new browser with the same code is 401 totp_failed, with the next code it has no window again', async () => {
    const { account, panel } = await signedIn();
    nextStep(current);
    const stepUpCode = codeNow(current, account.secret);
    const opened = await sendStepUp(panel, stepUpCode);
    expect(opened.status).toBe(200);
    adopt(panel, opened);
    expect((await panel.get(STEP_UP.audit)).status).toBe(200);

    const other = current.panel();
    const replayed = await sendLoginTotp(other, await startLogin(other, account), stepUpCode);
    expect(replayed.status).toBe(401);
    expect(codeOf(replayed)).toBe('totp_failed');

    nextStep(current);
    const { panel: second, response } = await signInWithTotp(current, account);
    expect(response.status).toBe(200);
    expect(codeOf(await second.get(STEP_UP.audit))).toBe('step_up_required');
  });

  it('EVM-134 AC4 K1 a code of an OLDER step is refused at the step-up though it lies inside the tolerance of ±1 step; the code of the NEXT step opens the window without moving the clock', async () => {
    const { account, panel } = await signedIn();
    const older = await sendStepUp(panel, codeNow(current, account.secret, -1));
    expect(older.status).toBe(401);
    expect(codeOf(older)).toBe('totp_failed');
    expect(codeOf(await panel.get(STEP_UP.audit))).toBe('step_up_required');

    const newer = await sendStepUp(panel, codeNow(current, account.secret, 1));
    expect(newer.status).toBe(200);
    adopt(panel, newer);
    expect((await panel.get(STEP_UP.audit)).status).toBe(200);
  });
});
