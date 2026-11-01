/**
 * The one way the operations on a session reach it (EVM-044 AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639): the order of the path through
 * the read policy, then the chain order → owner (a medium or a document, as the path says) → file → session in ONE statement with the creator (user AND device) in the condition.
 * A session of another user, another owner (or an owner of the other kind) or another order, and a missing one, are the same `404` — never `403`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { findSessionChain, type OwnerRef, type SessionChain } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { creatorOf } from './media-support.ts';

export interface SessionIds {
  readonly workOrderId: string;
  readonly owner: OwnerRef;
  readonly sessionId: string;
}

@Injectable()
export class SessionAccess {
  readonly #orders: WorkOrderDirectory;
  readonly #scopes: DocumentScopes;

  constructor(@Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory, @Inject(DocumentScopes) scopes: DocumentScopes) {
    this.#orders = orders;
    this.#scopes = scopes;
  }

  /** @throws ProblemException `not_found` — for the order, the medium and the session alike */
  async open(tx: Kysely<Database>, principal: Principal, ids: SessionIds, lock = false): Promise<SessionChain> {
    const order = await this.#orders.findVisible(tx, principal, ids.workOrderId);
    if (order === undefined) throw new ProblemException('not_found');
    // a DOCUMENT is reached through the order, its site and its customer (EVM-050: the file of a site document is uploaded in the order that added it);
    // a MEDIUM only through its own order
    const documentScope = ids.owner.kind === 'document' ? await this.#scopes.ofOrder(tx, principal, order) : undefined;
    const chain = await findSessionChain(
      mediaTables(tx),
      { ...ids, workOrderId: order.id, ...(documentScope === undefined ? {} : { documentScope }) },
      creatorOf(principal),
      lock,
    );
    if (chain === undefined) throw new ProblemException('not_found');
    return chain;
  }
}
