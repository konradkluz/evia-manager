/**
 * HTTP surface of the users of the identity module: the choice of an assignee for a work order (EVM-022) and the administration of the
 * accounts (EVM-024: the list, the invitation, the resend). The handlers contain no authorization — the global guard decides before they run
 * (the role, the web channel, CSRF and — for the invitation and the resend — the step-up of the Administrator); the answers are parsed with
 * the schemas of the contract, so only the fields of the contract can leave (SR-DATA-03).
 */
import { zAssignableUserList } from '@evia/contracts/zod';
import type { AssignableUserList, User, UserList } from '@evia/contracts';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { requestEventContext, webEventContext } from '../../../platform/http/request-context.ts';
import { InvitationService } from '../application/invitation.service.ts';
import { ListUsersService } from '../application/list-users.service.ts';
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

  constructor(
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(ListUsersService) lists: ListUsersService,
    @Inject(InvitationService) invitations: InvitationService,
  ) {
    this.#users = users;
    this.#lists = lists;
    this.#invitations = invitations;
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
}
