/**
 * The anchor of a document (EVM-050; domain-model.md, `Document`; SR-AUTHZ-02, SR-AUTHZ-08, AB-19): exactly one of the order, the site and the customer.
 * Pure functions, no framework. A document of a SITE is shown in the orders of EVERY customer of that site, so it can never be of the class
 * `identity_data` (the next customer would see the previous one's data); the database backs this up (0061), the kind-driven part of the rule lives here.
 */
import type { ConfidentialityClass } from './confidentiality.ts';

export const DOCUMENT_ANCHORS = ['work_order', 'site', 'customer'] as const;
export type DocumentAnchor = (typeof DOCUMENT_ANCHORS)[number];

export interface AnchorIssue {
  readonly pointer: string;
  readonly code: 'requires_work_order_anchor' | 'no_customer' | 'no_site' | 'identity_data_not_on_site';
}

export interface AnchorCheckInput {
  readonly anchor: DocumentAnchor;
  readonly hasSite: boolean;
  readonly hasCustomer: boolean;
  readonly hasStage: boolean;
  /** The class the document will have: the higher of the kind and the override. */
  readonly documentClass: ConfidentialityClass;
}

/** What is wrong with the anchor of a NEW document, as codes at pointers (never values). */
export function checkAnchor(input: AnchorCheckInput): AnchorIssue[] {
  const issues: AnchorIssue[] = [];
  if (input.hasStage && input.anchor !== 'work_order') issues.push({ pointer: '/procedureStageId', code: 'requires_work_order_anchor' });
  if (input.anchor === 'customer' && !input.hasCustomer) issues.push({ pointer: '/anchor', code: 'no_customer' });
  if (input.anchor === 'site' && !input.hasSite) issues.push({ pointer: '/anchor', code: 'no_site' });
  if (input.anchor === 'site' && input.documentClass === 'identity_data')
    issues.push({ pointer: '/anchor', code: 'identity_data_not_on_site' });
  return issues;
}

/** Whether a document of this anchor may be raised to the class (the class only goes up, so a site document must never reach `identity_data`). */
export const mayRaiseOnAnchor = (anchor: DocumentAnchor, to: ConfidentialityClass): boolean =>
  !(anchor === 'site' && to === 'identity_data');

export function anchorOf(row: {
  readonly work_order_id: string | null;
  readonly site_id: string | null;
  readonly customer_id: string | null;
}): DocumentAnchor {
  if (row.work_order_id !== null) return 'work_order';
  return row.site_id !== null ? 'site' : 'customer';
}
