/** The implementation of the `DocumentKindDirectory` facade (see `document-kind-directory.ts`): reads in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { DocumentKindDirectory, DocumentKindForDocument } from '../document-kind-directory.ts';
import { catalogTables } from '../infrastructure/tables.ts';

@Injectable()
export class DocumentKindDirectoryService implements DocumentKindDirectory {
  findActiveByCode(tx: Kysely<Database>, code: string): Promise<DocumentKindForDocument | undefined> {
    return catalogTables(tx)
      .selectFrom('catalog.document_kinds')
      .select(['code', 'name', 'confidentiality'])
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findByCodes(tx: Kysely<Database>, codes: readonly string[]): Promise<ReadonlyMap<string, DocumentKindForDocument>> {
    if (codes.length === 0) return new Map();
    const rows = await catalogTables(tx)
      .selectFrom('catalog.document_kinds')
      .select(['code', 'name', 'confidentiality'])
      .where('code', 'in', [...codes])
      .execute();
    return new Map(rows.map((row) => [row.code, row]));
  }
}
