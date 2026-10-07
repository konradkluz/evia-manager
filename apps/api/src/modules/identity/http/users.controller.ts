/**
 * HTTP surface of the users of the identity module (EVM-022): the choice of an assignee for a work order. The handler contains no
 * authorization — the global guard decides before it runs (Administrator and Editor, web channel); the answer is parsed with the
 * schema of the contract, so only `id` and `displayName` can leave it (SR-DATA-03).
 */
import { zAssignableUserList } from '@evia/contracts/zod';
import type { AssignableUserList } from '@evia/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { UserDirectory } from '../application/user-directory.ts';

@Controller()
export class UsersController {
  readonly #users: UserDirectory;

  constructor(@Inject(UserDirectory) users: UserDirectory) {
    this.#users = users;
  }

  @Get('/api/v1/users/assignable')
  @OperationId('listAssignableUsers')
  async listAssignableUsers(): Promise<AssignableUserList> {
    return zAssignableUserList.parse({ items: await this.#users.listAssignable(), nextCursor: null });
  }
}
