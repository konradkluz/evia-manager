/**
 * HTTP surface of the mobile channel (EVM-094; EVM-090 contract, ADR-0005, ADR-0021): the two steps of the sign-in of the phone, the renewal of its tokens, the
 * logout of the device, the confirmation of the wipe and the configuration of the client. Handlers contain no authorization — the global guard decides before
 * they run (the operation in the manifest, the channel, the role, the version of the app, the limits). A public operation reads no cookie and sets none; an
 * operation with a token reads the Bearer principal of the request and nothing else (`bearerPrincipalOf`) — the session of the panel does not exist here.
 * Every answer is `no-store` (the security headers of the whole API).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  zMobileLoginRequestWritable,
  zMobileLoginTotpRequest,
  zRefreshMobileSessionRequest,
  zWipeConfirmationRequestWritable,
} from '@evia/contracts/zod';
import type { ClientConfig, MobileLoginChallenge, MobileLoginRequestWritable, MobileSession } from '@evia/contracts';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../../platform/config/config.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { bearerPrincipalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { APP_CONFIG } from '../../../platform/tokens.ts';
import { readClientVersion, type ClientVersion } from '../domain/client-version.ts';
import { clientConfig } from '../domain/client-config.ts';
import type { ClientInfo } from '../application/activation.service.ts';
import { DeviceWipeService } from '../application/device-wipe.service.ts';
import { MobileLoginTotpService, type SignedInDevice } from '../application/mobile-login-totp.service.ts';
import { MobileLoginService } from '../application/mobile-login.service.ts';
import { MobileRefreshService, type RefreshedSession } from '../application/mobile-refresh.service.ts';
import { MobileSessionService } from '../application/mobile-session.service.ts';

const loginBody = strictObjects(zMobileLoginRequestWritable);
const loginTotpBody = strictObjects(zMobileLoginTotpRequest);
const refreshBody = strictObjects(zRefreshMobileSessionRequest);
const wipeBody = strictObjects(zWipeConfirmationRequestWritable);

const clientOf = (request: Request, response: Response): ClientInfo => ({
  context: webEventContext(request, response),
  // The phone sends no browser: nothing of the user agent is stored for a session of the mobile channel.
  userAgent: undefined,
});

/** The platform and the version of the app (the guard has refused a missing or old one already; this is for the types). */
function versionOf(request: Request): ClientVersion {
  const version = readClientVersion(request.get('x-client-platform'), request.get('x-client-version'));
  if (version === undefined) throw new ProblemException('internal_error');
  return version;
}

/** What a handler of an operation with a token can rely on: the guard has let the Bearer principal through. */
function requireMobilePrincipal(request: Request): Principal {
  const principal = bearerPrincipalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

/** A date of the calendar (the pattern of the contract admits 2026-13-45): the database would refuse it with a 500, so it is a 400 here. */
function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Beyond the schema: the pair of the installation is whole or absent, and the date of the patch exists. Pointers and codes only — never a value. */
function checkLogin(input: MobileLoginRequestWritable): void {
  const errors = [];
  if ((input.deviceId === undefined) !== (input.installationSecret === undefined)) {
    errors.push({ pointer: input.deviceId === undefined ? '/deviceId' : '/installationSecret', code: 'required' });
  }
  if (!isCalendarDate(input.device.securityPatch)) errors.push({ pointer: '/device/securityPatch', code: 'invalid_format' });
  if (errors.length > 0) throw new ProblemException('validation_failed', { errors });
}

const sessionOf = (session: RefreshedSession | SignedInDevice): MobileSession => ({
  deviceId: session.deviceId,
  ...('installationSecret' in session ? { installationSecret: session.installationSecret } : {}),
  accessToken: session.accessToken,
  accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
  refreshToken: session.refreshToken,
  refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  serverTime: session.serverTime.toISOString(),
  user: session.user,
});

@Controller()
export class MobileController {
  readonly #logins: MobileLoginService;
  readonly #totpLogins: MobileLoginTotpService;
  readonly #refreshes: MobileRefreshService;
  readonly #sessions: MobileSessionService;
  readonly #wipes: DeviceWipeService;
  readonly #minVersions: AppConfig['minSupportedAppVersion'];

  constructor(
    @Inject(MobileLoginService) logins: MobileLoginService,
    @Inject(MobileLoginTotpService) totpLogins: MobileLoginTotpService,
    @Inject(MobileRefreshService) refreshes: MobileRefreshService,
    @Inject(MobileSessionService) sessions: MobileSessionService,
    @Inject(DeviceWipeService) wipes: DeviceWipeService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#logins = logins;
    this.#totpLogins = totpLogins;
    this.#refreshes = refreshes;
    this.#sessions = sessions;
    this.#wipes = wipes;
    this.#minVersions = config.minSupportedAppVersion;
  }

  @Post('/api/v1/auth/mobile/login')
  @OperationId('mobileLogin')
  @HttpCode(200)
  async mobileLogin(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MobileLoginChallenge> {
    const input = parseInput(loginBody, body) as MobileLoginRequestWritable;
    checkLogin(input);
    const challenge = await this.#logins.login(input, versionOf(request), clientOf(request, response));
    return { challengeToken: challenge.challengeToken, challengeExpiresAt: challenge.challengeExpiresAt.toISOString() };
  }

  @Post('/api/v1/auth/mobile/login/totp')
  @OperationId('mobileLoginTotp')
  @HttpCode(200)
  async mobileLoginTotp(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MobileSession> {
    const { challengeToken, code } = parseInput(loginTotpBody, body) as { challengeToken: string; code: string };
    return sessionOf(await this.#totpLogins.verify(challengeToken, code, clientOf(request, response)));
  }

  @Post('/api/v1/auth/mobile/token')
  @OperationId('refreshMobileSession')
  @HttpCode(200)
  async refreshMobileSession(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MobileSession> {
    const { refreshToken } = parseInput(refreshBody, body) as { refreshToken: string };
    return sessionOf(await this.#refreshes.refresh(refreshToken, versionOf(request), clientOf(request, response)));
  }

  @Post('/api/v1/auth/mobile/logout')
  @OperationId('mobileLogout')
  @HttpCode(204)
  async mobileLogout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#sessions.logout(requireMobilePrincipal(request), webEventContext(request, response));
  }

  @Post('/api/v1/devices/current/wipe-confirmation')
  @OperationId('confirmDeviceWipe')
  @HttpCode(204)
  async confirmDeviceWipe(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const { deviceId, installationSecret } = parseInput(wipeBody, body) as { deviceId: string; installationSecret: string };
    await this.#wipes.confirm(deviceId, installationSecret, clientOf(request, response));
  }

  @Get('/api/v1/meta/client-config')
  @OperationId('getClientConfig')
  getClientConfig(@Req() request: Request): ClientConfig {
    requireMobilePrincipal(request);
    return clientConfig(this.#minVersions);
  }
}
