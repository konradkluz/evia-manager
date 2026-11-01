/**
 * What the services of the documents share (EVM-047): the representation of a document. The class is computed HERE, by the server, from the kind
 * of the catalog and the override stored with the document - one function ({@link effectiveClass}) for the list, the answer of a change and the
 * authorization of a download. The representation NEVER carries the object key, the S3 upload id or the checksum.
 */
import type { Document, UserRole } from '@evia/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { DocumentKindDirectory, DocumentKindForDocument } from '../../catalog/index.ts';
import type { ProcedureStageDirectory } from '../../procedures/index.ts';
import { anchorOf } from '../domain/document-anchor.ts';
import { effectiveClass, isRaised, mayDownloadDocument, type ConfidentialityClass } from '../domain/confidentiality.ts';
import type { DocumentWithFile } from '../infrastructure/document-store.ts';
import { stageNames } from './stage-support.ts';

/**
 * The class of the kind. A kind the catalog no longer knows (it cannot happen: the key is RESTRICT) is the most restricted class - fail closed.
 */
export const kindClassOf = (kind: DocumentKindForDocument | undefined): ConfidentialityClass => kind?.confidentiality ?? 'identity_data';

/** The effective class of a document: the higher of the kind and the override. */
export const classOfDocument = (row: DocumentWithFile, kind: DocumentKindForDocument | undefined): ConfidentialityClass =>
  effectiveClass(kindClassOf(kind), row.document.confidentiality_override);

export function toDocument(
  row: DocumentWithFile,
  kind: DocumentKindForDocument | undefined,
  role: UserRole,
  names: ReadonlyMap<string, string> = new Map(),
): Document {
  const { document, version, file } = row;
  const kindClass = kindClassOf(kind);
  const checksumMismatch = file.state === 'failed' && file.state_reason_code === 'checksum_mismatch';
  return {
    id: document.id,
    anchor: anchorOf(document),
    workOrderId: document.work_order_id,
    siteId: document.site_id,
    customerId: document.customer_id,
    kindCode: document.kind_code,
    kindName: kind?.name ?? document.kind_code,
    title: document.title,
    description: document.description,
    procedureStageId: document.procedure_stage_id,
    procedureStageName: document.procedure_stage_id === null ? null : (names.get(document.procedure_stage_id) ?? null),
    versionNumber: version.version_number,
    confidentiality: effectiveClass(kindClass, document.confidentiality_override),
    confidentialityRaised: isRaised(kindClass, document.confidentiality_override),
    fileState: file.state,
    stateReasonCode: checksumMismatch ? 'checksum_mismatch' : null,
    declaredSize: Number(file.declared_size_bytes),
    originalFilename: file.original_filename,
    canDownload: mayDownloadDocument(role, effectiveClass(kindClass, document.confidentiality_override)),
    createdAt: document.created_at.toISOString(),
    version: document.version,
  };
}

/** The representations of documents; the kinds and the names of the stages are read ONCE for all of them (no N+1). */
export async function presentDocuments(
  tx: Kysely<Database>,
  kinds: DocumentKindDirectory,
  stages: ProcedureStageDirectory,
  role: UserRole,
  rows: readonly DocumentWithFile[],
): Promise<Document[]> {
  const byCode = await kinds.findByCodes(tx, [...new Set(rows.map((row) => row.document.kind_code))]);
  const names = await stageNames(
    tx,
    stages,
    rows.map((row) => ({ workOrderId: row.document.work_order_id, stageId: row.document.procedure_stage_id })),
  );
  return rows.map((row) => toDocument(row, byCode.get(row.document.kind_code), role, names));
}
