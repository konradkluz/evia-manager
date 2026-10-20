/**
 * HTTP surface of the own account (EVM-028): the profile, the full re-authentication, the change of the password, the removal of a method of the second step
 * and "Moje sesje". The handlers contain no authorization — the global guard decides before they run (the operation in the manifest, CSRF, the state of the
 * session, the web channel, the role, the step-up of the sessions); here only the validation of the input, the call and the response. There is no identifier of
 * an account in any request: the account is the one of the session. The answers hold personal data (the global `Cache-Control: no-store` applies).
 */
import {
  zChangePasswordRequest,
  zEndAccountSessionPath,
  zReauthenticationRequestWritable,
  zRemovePasskeyPath,
  zUpdateAccountRequest,
} from '@evia/contracts/zod';
import type {
  Account,
  AccountSessionList,
  ChangePasswordRequest,
  EndedSessions,
  PasswordChanged,
  ReauthenticationRequestWritable,
  UpdateAccountRequest,
} from '@evia/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { AccountSessionsService } from '../application/account-sessions.service.ts';
import { AccountService } from '../application/account.service.ts';
import type { ClientInfo } from '../application/activation.service.ts';
import { PasswordChangeService } from '../application/password-change.service.ts';
import { ReauthenticationService } from '../application/reauthentication.service.ts';
import { SecondStepManagementService } from '../application/second-step-management.service.ts';
import { readDeviceCookie } from './device-cookie.ts';

const updateAccountBody = strictObjects(zUpdateAccountRequest);
const changePasswordBody = strictObjects(zChangePasswordRequest);
const reauthenticateBody = strictObjects(zReauthenticationRequestWritable);
const removePasskeyPath = strictObjects(zRemovePasskeyPath);
const endSessionPath = strictObjects(zEndAccountSessionPath);

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
export class AccountController {
  readonly #accounts: AccountService;
  readonly #reauthentication: ReauthenticationService;
  readonly #passwords: PasswordChangeService;
  readonly #management: SecondStepManagementService;
  readonly #sessions: AccountSessionsService;

  constructor(
    @Inject(AccountService) accounts: AccountService,
    @Inject(ReauthenticationService) reauthentication: ReauthenticationService,
    @Inject(PasswordChangeService) passwords: PasswordChangeService,
    @Inject(SecondStepManagementService) management: SecondStepManagementService,
    @Inject(AccountSessionsService) sessions: AccountSessionsService,
  ) {
    this.#accounts = accounts;
    this.#reauthentication = reauthentication;
    this.#passwords = passwords;
    this.#management = management;
    this.#sessions = sessions;
  }

  @Get('/api/v1/account')
  @OperationId('getAccount')
  getAccount(@Req() request: Request): Promise<Account> {
    return this.#accounts.get(requirePrincipal(request));
  }

  @Patch('/api/v1/account')
  @OperationId('updateAccount')
  @HttpCode(200)
  updateAccount(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Account> {
    const { displayName } = parseInput(updateAccountBody, body) as UpdateAccountRequest;
    return this.#accounts.updateProfile(requirePrincipal(request), displayName, clientOf(request, response));
  }

  @Post('/api/v1/account/reauthentication')
  @OperationId('reauthenticate')
  @HttpCode(204)
  async reauthenticate(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const input = parseInput(reauthenticateBody, body) as ReauthenticationRequestWritable;
    await this.#reauthentication.reauthenticate(
      requirePrincipal(request),
      input,
      clientOf(request, response),
      readDeviceCookie(request.headers.cookie),
    );
  }

  @Post('/api/v1/account/password')
  @OperationId('changePassword')
  @HttpCode(200)
  changePassword(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PasswordChanged> {
    const input = parseInput(changePasswordBody, body) as ChangePasswordRequest;
    return this.#passwords.change(requirePrincipal(request), input, clientOf(request, response), readDeviceCookie(request.headers.cookie));
  }

  @Delete('/api/v1/account/passkeys/:passkeyId')
  @OperationId('removePasskey')
  @HttpCode(204)
  async removePasskey(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const { passkeyId } = parseInput(removePasskeyPath, params) as { passkeyId: string };
    await this.#management.removePasskey(requirePrincipal(request), passkeyId, clientOf(request, response));
  }

  @Delete('/api/v1/account/totp')
  @OperationId('removeTotp')
  @HttpCode(204)
  async removeTotp(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#management.removeTotp(requirePrincipal(request), clientOf(request, response));
  }

  @Get('/api/v1/account/sessions')
  @OperationId('listAccountSessions')
  listAccountSessions(@Req() request: Request): Promise<AccountSessionList> {
    return this.#sessions.list(requirePrincipal(request));
  }

  @Delete('/api/v1/account/sessions')
  @OperationId('endOtherAccountSessions')
  @HttpCode(200)
  endOtherAccountSessions(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<EndedSessions> {
    return this.#sessions.endOthers(requirePrincipal(request), clientOf(request, response));
  }

  @Delete('/api/v1/account/sessions/:sessionId')
  @OperationId('endAccountSession')
  @HttpCode(204)
  async endAccountSession(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { sessionId } = parseInput(endSessionPath, params) as { sessionId: string };
    await this.#sessions.end(requirePrincipal(request), sessionId, clientOf(request, response));
  }
}
