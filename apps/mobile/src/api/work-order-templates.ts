/**
 * The list of templates of work orders as the API client reads it (EVM-106 AC1, ADR-0004: only `src/api` imports the generated
 * contract). The answer is validated with the strict schema of the contract (limits of length and count); anything else is `null`
 * (the caller keeps the old set). Only the allow-listed fields leave this module: no items, procedures or payment milestones.
 */
import { zWorkOrderTemplateList } from '@evia/contracts/zod';

export interface ApiTemplate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly siteTypeHint: string | null;
  readonly itemCount: number;
  readonly procedureCount: number;
  readonly milestoneCount: number;
}

/** The active templates of an answer of `listWorkOrderTemplates`, or `null` when the answer is not the contract. */
export function readTemplateList(body: unknown): readonly ApiTemplate[] | null {
  const parsed = zWorkOrderTemplateList.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.items
    .filter((template) => template.isActive)
    .map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      siteTypeHint: template.siteTypeHint,
      itemCount: template.items.length,
      procedureCount: template.procedures.length,
      milestoneCount: template.paymentMilestones.length,
    }));
}
