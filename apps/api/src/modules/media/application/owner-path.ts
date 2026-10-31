/**
 * The path of an operation on an upload session, for either owner of a file (EVM-047): the same operations serve the media
 * (`/media-assets/{mediaAssetId}/…`) and the documents (`/documents/{documentId}/…`). The PATH names the kind of the owner; the lookup of the
 * chain then asks for exactly that kind, so an identifier of the other kind is simply not found (`404`).
 */
import {
  zAbortDocumentUploadSessionPath,
  zAbortUploadSessionPath,
  zCompleteDocumentUploadSessionPath,
  zCompleteUploadSessionPath,
  zCreateDocumentUploadSessionPath,
  zCreateUploadSessionPath,
  zGetDocumentUploadPartUrlPath,
  zGetUploadPartUrlPath,
  zListDocumentUploadPartsPath,
  zListUploadPartsPath,
} from '@evia/contracts/zod';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { OwnerRef } from '../infrastructure/media-store.ts';

export type OwnerKind = OwnerRef['kind'];
export type SessionOperation = 'create' | 'list' | 'url' | 'complete' | 'abort';

const SCHEMAS = {
  media_asset: {
    create: strictObjects(zCreateUploadSessionPath),
    list: strictObjects(zListUploadPartsPath),
    url: strictObjects(zGetUploadPartUrlPath),
    complete: strictObjects(zCompleteUploadSessionPath),
    abort: strictObjects(zAbortUploadSessionPath),
  },
  document: {
    create: strictObjects(zCreateDocumentUploadSessionPath),
    list: strictObjects(zListDocumentUploadPartsPath),
    url: strictObjects(zGetDocumentUploadPartUrlPath),
    complete: strictObjects(zCompleteDocumentUploadSessionPath),
    abort: strictObjects(zAbortDocumentUploadSessionPath),
  },
} as const;

export interface OwnerPath {
  readonly workOrderId: string;
  readonly owner: OwnerRef;
  readonly sessionId: string;
  readonly partNumber: number;
}

/** @throws ProblemException `validation_failed` — the path does not fit the schema of the operation */
export function parseOwnerPath(kind: OwnerKind, operation: SessionOperation, rawParams: unknown): OwnerPath {
  const parsed = parseInput(SCHEMAS[kind][operation], rawParams) as Record<string, string | number | undefined>;
  const id = (kind === 'document' ? parsed['documentId'] : parsed['mediaAssetId']) as string;
  return {
    workOrderId: parsed['workOrderId'] as string,
    owner: { kind, id },
    sessionId: (parsed['sessionId'] as string | undefined) ?? '',
    partNumber: (parsed['partNumber'] as number | undefined) ?? 0,
  };
}
