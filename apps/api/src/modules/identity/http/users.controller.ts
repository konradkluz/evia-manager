/**
 * HTTP surface of the users of the identity module: the choice of an assignee for a work order (EVM-022) and the administration of the
 * accounts (EVM-024: the list, the invitation, the resend). The handlers contain no authorization — the global guard decides before they run
 * (the role, the web channel, CSRF and — for the invitation and the resend — the step-up of the Administrator); the answers are parsed with
 * the schemas of the contract, so only the fields of the contract can leave (SR-DATA-03).
 */
import { zAssignableUserList } from '@evia/contracts/zod';
import type { AssignableUserList, User, UserList } from '@evia/contracts';
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { entityTag } from '../../../platform/http/if-match.ts';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { InvitationService } from '../application/invitation.service.ts';
import { ListUsersService } from '../application/list-users.service.ts';
import { UserAccessService } from '../application/user-access.service.ts';
import { UserDirectory } from '../application/user-directory.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class UsersController {
  readonly #users: UserDirectory;
  readonly #lists: ListUsersService;
  readonly #invitations: InvitationService;
  readonly #access: UserAccessService;

  constructor(
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(ListUsersService) lists: ListUsersService,
    @Inject(InvitationService) invitations: InvitationService,
    @Inject(UserAccessService) access: UserAccessService,
  ) {
    this.#users = users;
    this.#lists = lists;
    this.#invitations = invitations;
    this.#access = access;
  }

  @Get('/api/v1/users/assignable')
  @OperationId('listAssignableUsers')
  async listAssignableUsers(): Promise<AssignableUserList> {
    return zAssignableUserList.parse({ items: await this.#users.listAssignable(), nextCursor: null });
  }

  @Get('/api/v1/users')
  @OperationId('listUsers')
  listUsers(@Query() query: unknown, @Req() request: Request): Promise<UserList> {
    return this.#lists.list(requirePrincipal(request), query);
  }

  @Post('/api/v1/users')
  @OperationId('inviteUser')
  @HttpCode(201)
  async inviteUser(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const { user, replayed } = await this.#invitations.invite(
      requirePrincipal(request),
      body,
      idempotencyKey,
      webEventContext(request, response),
    );
    response.set('Location', `/api/v1/users/${user.id}`);
    if (replayed) response.set('Idempotent-Replayed', 'true');
    return user;
  }

  @Post('/api/v1/users/:userId/invitations')
  @OperationId('resendUserInvitation')
  @HttpCode(200)
  resendUserInvitation(@Param() params: unknown, @Req() request: Request): Promise<User> {
    return this.#invitations.resend(requirePrincipal(request), params, requestEventContext(request));
  }

  @Put('/api/v1/users/:userId/role')
  @OperationId('changeUserRole')
  @HttpCode(200)
  async changeUserRole(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const user = await this.#access.changeRole(requirePrincipal(request), params, ifMatch, body, webEventContext(request, response));
    response.set('ETag', entityTag(user.version));
    return user;
  }

  @Post('/api/v1/users/:userId/deactivation')
  @OperationId('deactivateUser')
  @HttpCode(200)
  async deactivateUser(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const user = await this.#access.deactivate(requirePrincipal(request), params, ifMatch, webEventContext(request, response));
    response.set('ETag', entityTag(user.version));
    return user;
  }

  @Post('/api/v1/users/:userId/reactivation')
  @OperationId('reactivateUser')
  @HttpCode(200)
  async reactivateUser(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const user = await this.#access.reactivate(requirePrincipal(request), params, ifMatch, webEventContext(request, response));
    response.set('ETag', entityTag(user.version));
    return user;
  }

  @Delete('/api/v1/users/:userId/sessions')
  @OperationId('endUserSessions')
  @HttpCode(204)
  async endUserSessions(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#access.endSessions(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Post('/api/v1/users/:userId/second-step-reset')
  @OperationId('resetUserSecondStep')
  @HttpCode(200)
  async resetUserSecondStep(
    @Param() params: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<User> {
    const user = await this.#access.resetSecondStep(requirePrincipal(request), params, ifMatch, body, webEventContext(request, response));
    response.set('ETag', entityTag(user.version));
    return user;
  }
}
