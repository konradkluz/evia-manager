/**
 * The phone as the API sees it (EVM-094): no cookies, no Origin, `Authorization: Bearer`, the headers of the version of the app. The two steps of the sign-in
 * with a code computed here with the clock of the app under test (never a fixed code), the renewal of tokens, the logout and the confirmation of the wipe.
 * Each helper returns the raw response so a test can assert on it. Synthetic data only.
 */
import { sql } from 'kysely';
import request, { type Response, type Test } from 'supertest';
import { hashToken } from '../../src/modules/identity/domain/tokens.ts';
import type { IdentityApp } from './identity-app.ts';
import { codeNow, nextStep, type TotpAccount } from './totp-flows.ts';

export const MOBILE = {
  login: '/api/v1/auth/mobile/login',
  totp: '/api/v1/auth/mobile/login/totp',
  token: '/api/v1/auth/mobile/token',
  logout: '/api/v1/auth/mobile/logout',
  wipe: '/api/v1/devices/current/wipe-confirmation',
  config: '/api/v1/meta/client-config',
} as const;

/** The app of the tests: Android at the minimum version the test configuration serves (1.2.0). */
export const APP_HEADERS: Readonly<Record<string, string>> = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.2.0' };

export const DEVICE = { model: 'Pixel 8', osVersion: '14', securityPatch: '2026-09-05' } as const;

export interface PhoneSession {
  readonly deviceId: string;
  readonly installationSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshTokenExpiresAt: string;
  readonly serverTime: string;
  readonly user: { id: string; displayName: string; role: string };
}

type Server = Parameters<typeof request>[0];

export class Phone {
  readonly #server: Server;
  /** What the phone holds after a sign-in: the pair of the installation and the tokens. */
  deviceId: string | undefined;
  installationSecret: string | undefined;
  accessToken: string | undefined;
  refreshToken: string | undefined;

  constructor(server: Server) {
    this.#server = server;
  }

  /** A mutation as the phone sends it: JSON, the headers of the app, no Origin, no cookie. */
  post(path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server).post(path);
    for (const [name, value] of Object.entries({ ...APP_HEADERS, ...headers })) call = call.set(name, value);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  get(path: string, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server).get(path);
    for (const [name, value] of Object.entries({ ...APP_HEADERS, ...headers })) call = call.set(name, value);
    return call;
  }

  /** With the access token it holds (`Authorization: Bearer`). */
  authorised(headers: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken ?? ''}`, ...headers };
  }

  adopt(response: Response): void {
    const body = response.body as Partial<PhoneSession>;
    this.deviceId = body.deviceId ?? this.deviceId;
    this.installationSecret = body.installationSecret ?? this.installationSecret;
    this.accessToken = body.accessToken ?? this.accessToken;
    this.refreshToken = body.refreshToken ?? this.refreshToken;
  }

  /** The first step; with `pair`, the phone introduces itself as the installation it already is. */
  firstStep(
    account: Pick<TotpAccount, 'email' | 'password'>,
    options: { pair?: boolean; extra?: Record<string, unknown>; headers?: Record<string, string>; device?: Record<string, unknown> } = {},
  ): Promise<Response> {
    const pair = options.pair === true ? { deviceId: this.deviceId, installationSecret: this.installationSecret } : {};
    return Promise.resolve(
      this.post(
        MOBILE.login,
        { email: account.email, password: account.password, device: options.device ?? DEVICE, ...pair, ...options.extra },
        options.headers,
      ),
    );
  }

  secondStep(challengeToken: string, code: string, headers: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(this.post(MOBILE.totp, { challengeToken, code }, headers));
  }

  refresh(refreshToken: string | undefined = this.refreshToken, headers: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(this.post(MOBILE.token, { refreshToken }, headers));
  }
}

export const newPhone = (app: IdentityApp): Phone => new Phone(app.app.getHttpServer());

/**
 * Both steps of the sign-in. The clock moves into the next step of the code first (a code is spent once, in the panel and on the phone alike). The phone
 * adopts the session when it is given one. @returns both responses (the second is the first when the first was refused)
 */
export async function signInPhone(
  app: IdentityApp,
  phone: Phone,
  account: TotpAccount,
  options: { pair?: boolean; headers?: Record<string, string>; device?: Record<string, unknown>; code?: string } = {},
): Promise<{ first: Response; second: Response }> {
  nextStep(app);
  const first = await phone.firstStep(account, {
    ...(options.pair === undefined ? {} : { pair: options.pair }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.device === undefined ? {} : { device: options.device }),
  });
  if (first.status !== 200) return { first, second: first };
  const { challengeToken } = first.body as { challengeToken: string };
  const second = await phone.secondStep(challengeToken, options.code ?? codeNow(app, account.secret), options.headers);
  if (second.status === 200) phone.adopt(second);
  return { first, second };
}

/** A phone that has signed in (it throws when it could not). */
export async function signedInPhone(
  app: IdentityApp,
  account: TotpAccount,
  options: Parameters<typeof signInPhone>[3] = {},
): Promise<Phone> {
  const phone = newPhone(app);
  const { second } = await signInPhone(app, phone, account, options);
  if (second.status !== 200) throw new Error(`the phone could not sign in: ${second.status} ${JSON.stringify(second.body)}`);
  return phone;
}

export const wrongCode = (app: IdentityApp, secret: string): string => (codeNow(app, secret) === '000000' ? '000001' : '000000');

/** The row of a device as the database holds it (to prove what is and is not stored). */
export async function deviceRow(app: IdentityApp, deviceId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await sql<Record<string, unknown>>`select * from identity.devices where id = ${deviceId}`.execute(app.database.admin);
  return rows[0];
}

export async function devicesOf(app: IdentityApp, userId: string): Promise<Array<Record<string, unknown>>> {
  return (
    await sql<Record<string, unknown>>`select * from identity.devices where user_id = ${userId} order by created_at, id`.execute(
      app.database.admin,
    )
  ).rows;
}

export async function mobileSessionsOf(app: IdentityApp, userId: string): Promise<Array<Record<string, unknown>>> {
  return (
    await sql<
      Record<string, unknown>
    >`select * from identity.sessions where user_id = ${userId} and channel = 'mobile' order by created_at, id`.execute(app.database.admin)
  ).rows;
}

export async function setDeviceState(app: IdentityApp, deviceId: string, state: 'active' | 'wipe_required' | 'wiped'): Promise<void> {
  await sql`update identity.devices set state = ${state} where id = ${deviceId}`.execute(app.database.admin);
}

export const sha = hashToken;
