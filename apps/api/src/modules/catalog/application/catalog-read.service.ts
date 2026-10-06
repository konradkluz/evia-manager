/**
 * Reading the configuration (EVM-019 AC4, AC5): the use cases of the module. Authorization is decided before this code
 * runs (the global guard: the three roles, web channel); there is no object policy because the configuration is global
 * (KONF, no personal data). Reading configuration is not a sensitive event, so nothing is audited (SR-LOG-02).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DocumentKindList, ProcedureTemplateList, ServiceItemList, WorkOrderTemplate, WorkOrderTemplateList } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { distinctProcedures } from '../domain/template-preview.ts';
import {
  findWorkOrderTemplates,
  listDocumentKinds,
  listProcedureTemplates,
  listServiceItems,
  type WorkOrderTemplateRow,
} from '../infrastructure/queries.ts';
import { catalogTables } from '../infrastructure/tables.ts';

/** The whole set in one page: configuration lists are small, so the cursor is always `null`. */
const wholeSet = <T>(items: T[]): { items: T[]; nextCursor: null } => ({ items, nextCursor: null });

/** The rows hold database strings for the vocabularies; the controller validates the response against the contract. */
const toPreview = (row: WorkOrderTemplateRow): WorkOrderTemplate =>
  ({ ...row, procedures: distinctProcedures(row.procedures) }) as WorkOrderTemplate;

@Injectable()
export class CatalogReadService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /** Active templates only (AC5), optionally of one site type. */
  async activeTemplates(siteTypeHint: string | undefined): Promise<WorkOrderTemplateList> {
    const rows = await findWorkOrderTemplates(catalogTables(this.#db), {
      activeOnly: true,
      ...(siteTypeHint === undefined ? {} : { siteTypeHint }),
    });
    return wholeSet(rows.map(toPreview));
  }

  /** A template by id — a retired one too (`isActive = false`, the basis of `template_unavailable` in EVM-022). */
  async templateById(templateId: string): Promise<WorkOrderTemplate | undefined> {
    const [row] = await findWorkOrderTemplates(catalogTables(this.#db), { id: templateId, activeOnly: false });
    return row === undefined ? undefined : toPreview(row);
  }

  async serviceItems(): Promise<ServiceItemList> {
    return wholeSet((await listServiceItems(catalogTables(this.#db))) as ServiceItemList['items']);
  }

  async procedureTemplates(): Promise<ProcedureTemplateList> {
    return wholeSet((await listProcedureTemplates(catalogTables(this.#db))) as ProcedureTemplateList['items']);
  }

  async documentKinds(): Promise<DocumentKindList> {
    return wholeSet((await listDocumentKinds(catalogTables(this.#db))) as DocumentKindList['items']);
  }
}
