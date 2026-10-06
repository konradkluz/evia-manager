/**
 * HTTP surface of the identity module (EVM-016): activation with a one-time link, the current session, logout and the
 * passkey of the account. Handlers contain no authorization — the global guard decides before they run (operation in
 * the manifest, CSRF, enrolment state, channel, role); here only input validation, the call and the response.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { zCheckActivationLinkRequest, zRegisterPasskeyRequest, zSetActivationPasswordRequestWritable } from '@evia/contracts/zod';
import type {
  ActivationLinkInfo,
  ActivationPasswordResult,
  CurrentSession,
  Passkey,
  PasskeyRegistrationOptions,
  RegisterPasskeyRequest,
} from '@evia/contracts';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { ActivationService, type ClientInfo } from '../application/activation.service.ts';
import { PasskeyService } from '../application/passkey.service.ts';
import { SessionService } from '../application/session.service.ts';
import { clearedSessionCookie, sessionCookie } from './session-cookie.ts';

const checkLinkBody = strictObjects(zCheckActivationLinkRequest);
const setPasswordBody = strictObjects(zSetActivationPasswordRequestWritable);
const registerPasskeyBody = strictObjects(zRegisterPasskeyRequest);

/** What a handler of an authenticated operation can rely on: the guard has let a principal through. */
function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

const clientOf = (request: Request, response: Response): ClientInfo => ({
  context: webEventContext(request, response),
  userAgent: request.get('user-agent'),
});

@Controller()
export class AuthController {
  readonly #activation: ActivationService;
  readonly #passkeys: PasskeyService;
  readonly #sessions: SessionService;

  constructor(
    @Inject(ActivationService) activation: ActivationService,
    @Inject(PasskeyService) passkeys: PasskeyService,
    @Inject(SessionService) sessions: SessionService,
  ) {
    this.#activation = activation;
    this.#passkeys = passkeys;
    this.#sessions = sessions;
  }

  @Post('/api/v1/auth/activation/check')
  @OperationId('checkActivationLink')
  @HttpCode(200)
  checkActivationLink(@Body() body: unknown): Promise<ActivationLinkInfo> {
    const { token } = parseInput(checkLinkBody, body) as { token: string };
    return this.#activation.checkLink(token);
  }

  @Post('/api/v1/auth/activation/password')
  @OperationId('setActivationPassword')
  @HttpCode(200)
  async setActivationPassword(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ActivationPasswordResult> {
    const { token, password } = parseInput(setPasswordBody, body) as { token: string; password: string };
    const session = await this.#activation.setPassword(token, password, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { csrfToken: session.csrfToken };
  }

  @Get('/api/v1/auth/session')
  @OperationId('getCurrentSession')
  getCurrentSession(@Req() request: Request): Promise<CurrentSession> {
    return this.#sessions.current(requirePrincipal(request));
  }

  @Post('/api/v1/auth/logout')
  @OperationId('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#sessions.logout(requirePrincipal(request), webEventContext(request, response));
    response.set('Clear-Site-Data', '"cache", "storage"');
    response.set('Set-Cookie', clearedSessionCookie());
  }

  @Post('/api/v1/account/passkeys/registration-options')
  @OperationId('getPasskeyRegistrationOptions')
  @HttpCode(200)
  getPasskeyRegistrationOptions(@Req() request: Request): Promise<PasskeyRegistrationOptions> {
    return this.#passkeys.registrationOptions(requirePrincipal(request)) as Promise<PasskeyRegistrationOptions>;
  }

  @Post('/api/v1/account/passkeys')
  @OperationId('registerPasskey')
  @HttpCode(201)
  async registerPasskey(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Passkey> {
    const input = parseInput(registerPasskeyBody, body) as RegisterPasskeyRequest;
    const result = await this.#passkeys.register(requirePrincipal(request), input, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(result.sessionToken, result.maxAgeSeconds));
    return result.passkey;
  }
}
