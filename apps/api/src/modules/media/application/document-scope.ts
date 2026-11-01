/**
 * Which documents the path of an ORDER reaches (EVM-050; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-08, CWE-639). A document of a site or a customer is added in an
 * order and its file is uploaded there, so the operations on the path of an order (the change, the upload, the download) reach the documents anchored to
 * the order, to ITS site and to ITS customer. The site and the customer count ONLY while the caller may still see them (the read policy of `sites` and
 * `customers`, deleted ones included): the documents of a deleted site or customer are as unreachable by this path as by their own (AC7). The media
 * are never in this scope - it is a scope of DOCUMENTS.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import type { WorkOrderRef } from '../../work-orders/index.ts';
import type { DocumentScope } from '../infrastructure/document-store.ts';

@Injectable()
export class DocumentScopes {
  readonly #sites: SiteDirectory;
  readonly #customers: CustomerDirectory;

  constructor(@Inject(SITE_DIRECTORY) sites: SiteDirectory, @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory) {
    this.#sites = sites;
    this.#customers = customers;
  }

  /** The order, its site and its customer - the last two only when visible to the caller. */
  async ofOrder(tx: Kysely<Database>, principal: Principal, order: WorkOrderRef): Promise<DocumentScope> {
    const site = order.siteId === null ? undefined : await this.#sites.findVisible(tx, principal, order.siteId);
    const customer = order.customerId === null ? undefined : await this.#customers.findVisible(tx, principal, order.customerId);
    return { workOrderId: order.id, siteId: site?.id, customerId: customer?.id };
  }
}
