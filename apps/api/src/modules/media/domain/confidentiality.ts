/**
 * The confidentiality class of a document (EVM-047; P6, SR-AUTHZ-06, SR-AUTHZ-07, AB-20; domain-model.md, `Document.confidentialityOverride`). Pure
 * functions, no framework. The order is `standard` < `building_security` < `identity_data`. The EFFECTIVE class is the higher of the class of the kind
 * (the catalog) and the override of the document; it is computed by the server from the database every time and never taken from the client. The
 * override can only RISE: a lower or equal class is refused, and the database trigger of 0059 backs this up.
 */
import type { UserRole } from '@evia/contracts';

export const CONFIDENTIALITY_CLASSES = ['standard', 'building_security', 'identity_data'] as const;
export type ConfidentialityClass = (typeof CONFIDENTIALITY_CLASSES)[number];
/** The classes an override can take (`standard` is the floor: it can never be an override). */
export type ConfidentialityOverride = Exclude<ConfidentialityClass, 'standard'>;

/** The code of the kind of document whose class is decided by the question about identity data (AC3). */
export const OTHER_KIND_CODE = 'other';

const RANK: Readonly<Record<ConfidentialityClass, number>> = { standard: 0, building_security: 1, identity_data: 2 };

export const isHigher = (a: ConfidentialityClass, b: ConfidentialityClass): boolean => RANK[a] > RANK[b];

export const maxClass = (a: ConfidentialityClass, b: ConfidentialityClass): ConfidentialityClass => (isHigher(b, a) ? b : a);

/** The ONE function that decides the class of a document: the higher of the class of the kind and the override. */
export const effectiveClass = (kindClass: ConfidentialityClass, override: ConfidentialityOverride | null): ConfidentialityClass =>
  override === null ? kindClass : maxClass(kindClass, override);

/** Whether the class was raised above the one of the kind (the "raised" mark in the list). */
export const isRaised = (kindClass: ConfidentialityClass, override: ConfidentialityOverride | null): boolean =>
  isHigher(effectiveClass(kindClass, override), kindClass);

/** P6 and SR-AUTHZ-06: Administrator and Editor take every class; Read-only only `standard`. Deny by default for any other role. */
export function mayDownloadDocument(role: UserRole, documentClass: ConfidentialityClass): boolean {
  switch (role) {
    case 'administrator':
    case 'editor':
      return true;
    case 'read_only':
      return documentClass === 'standard';
    default:
      return false;
  }
}

export interface DocumentClassInput {
  readonly kindCode: string;
  readonly kindClass: ConfidentialityClass;
  readonly containsIdentityData?: boolean | undefined;
  readonly confidentialityOverride?: ConfidentialityOverride | undefined;
}

export type ClassIssueCode = 'required' | 'not_applicable' | 'not_higher';
type ClassField = 'containsIdentityData' | 'confidentialityOverride';
export type ClassResult =
  | { readonly ok: true; readonly override: ConfidentialityOverride | null }
  | { readonly ok: false; readonly issues: ReadonlyArray<{ readonly field: ClassField; readonly code: ClassIssueCode }> };

/**
 * The override to store for a NEW document. The answer about identity data belongs to the kind `other` only (required there, refused elsewhere); `true`
 * is stored as the override `identity_data` (not computed in the panel). An explicit override must be strictly higher than the class of the kind.
 */
export function resolveNewDocumentClass(input: DocumentClassInput): ClassResult {
  const issues: Array<{ field: ClassField; code: ClassIssueCode }> = [];
  const isOther = input.kindCode === OTHER_KIND_CODE;
  if (isOther && input.containsIdentityData === undefined) issues.push({ field: 'containsIdentityData', code: 'required' });
  if (!isOther && input.containsIdentityData !== undefined) issues.push({ field: 'containsIdentityData', code: 'not_applicable' });
  if (input.confidentialityOverride !== undefined && !isHigher(input.confidentialityOverride, input.kindClass)) {
    issues.push({ field: 'confidentialityOverride', code: 'not_higher' });
  }
  if (issues.length > 0) return { ok: false, issues };
  const explicit = input.confidentialityOverride ?? null;
  if (input.containsIdentityData !== true) return { ok: true, override: explicit };
  return { ok: true, override: 'identity_data' };
}

/** A raise of an existing document: the requested class must be STRICTLY higher than the effective one (kind and current override). */
export const canRaiseTo = (
  kindClass: ConfidentialityClass,
  current: ConfidentialityOverride | null,
  requested: ConfidentialityOverride,
): boolean => isHigher(requested, effectiveClass(kindClass, current));
