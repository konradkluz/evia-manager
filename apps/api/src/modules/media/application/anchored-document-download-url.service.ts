/**
 * The signed address of the file of a document of a SITE or a CUSTOMER (EVM-050 AC3, AC5, AC6; SR-AUTHZ-02, SR-AUTHZ-06, SR-AUTHZ-07, SR-FILE-07, SR-FILE-10). Only the
 * resolution of the anchor is here: the site (customer) of the path goes through the read policy of its module (`404` for a missing and a deleted one), and
 * ONE statement reads the document whose OWN anchor is that site (customer) - a document of another site, of an order, and a medium are the same `404`.
 * Everything after that - the class and the `403` of Read-only, the state of the file, the ONE counter of the originals, the signature, the audit - is the
 * code of {@link DocumentDownloadUrlService}, in the same order, so a new path cannot loosen a rule of the old one.
 */
import type { DocumentDownloadUrl } from '@evia/contracts';
import { zCreateCustomerDocumentDownloadUrlPath, zCreateSiteDocumentDownloadUrlPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { findDocumentWithFile } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { DocumentDownloadUrlService } from './document-download-url.service.ts';

const sitePathSchema = strictObjects(zCreateSiteDocumentDownloadUrlPath);
const customerPathSchema = strictObjects(zCreateCustomerDocumentDownloadUrlPath);

@Injectable()
export class AnchoredDocumentDownloadUrlService {
  readonly #downloads: DocumentDownloadUrlService;
  readonly #sites: SiteDirectory;
  readonly #customers: CustomerDirectory;

  constructor(
    @Inject(DocumentDownloadUrlService) downloads: DocumentDownloadUrlService,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
  ) {
    this.#downloads = downloads;
    this.#sites = sites;
    this.#customers = customers;
  }

  createForSite(principal: Principal, rawParams: unknown, context: EventContext): Promise<DocumentDownloadUrl> {
    const { siteId, documentId } = parseInput(sitePathSchema, rawParams) as { siteId: string; documentId: string };
    return this.#downloads.issue(principal, documentId, context, async (tx) => {
      const site = await this.#sites.findVisible(tx, principal, siteId);
      return site === undefined ? undefined : findDocumentWithFile(mediaTables(tx), { siteId: site.id }, documentId);
    });
  }

  createForCustomer(principal: Principal, rawParams: unknown, context: EventContext): Promise<DocumentDownloadUrl> {
    const { customerId, documentId } = parseInput(customerPathSchema, rawParams) as { customerId: string; documentId: string };
    return this.#downloads.issue(principal, documentId, context, async (tx) => {
      const customer = await this.#customers.findVisible(tx, principal, customerId);
      return customer === undefined ? undefined : findDocumentWithFile(mediaTables(tx), { customerId: customer.id }, documentId);
    });
  }
}
