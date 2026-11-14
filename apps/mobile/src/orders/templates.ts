/**
 * The templates of work orders kept on the phone (EVM-106 AC1; security K3, K4): the office catalogue is read once per cycle, reduced
 * to a small allow-list (id, code, name, hint of the site type, counters - never the items, procedures or payment milestones) and kept
 * in the encrypted database as one document that is replaced as a whole. Templates are not personal data.
 * Both directions are validated: the answer of the server with the strict contract schema (anything else leaves the old set), and the
 * stored document again on reading (a damaged value is "no templates", never a crash).
 */
import { readTemplateList } from '../api/work-order-templates';

export const SITE_TYPES = ['single_family_house', 'multi_family_garage', 'commercial', 'other'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export interface PhoneTemplate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** `null` = suits every type of site (or a type this version of the app does not know). */
  readonly siteTypeHint: SiteType | null;
  readonly itemCount: number;
  readonly procedureCount: number;
  readonly milestoneCount: number;
}

export interface TemplateSet {
  /** Epoch milliseconds on the phone when the set was downloaded. */
  readonly fetchedAt: number;
  readonly items: readonly PhoneTemplate[];
}

export const MAX_STORED_TEMPLATES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSiteType = (value: unknown): value is SiteType => SITE_TYPES.some((type) => type === value);

/** The active templates of an answer of the server, or `null` when the answer is not what the contract says (the old set stays). */
export function parseTemplateResponse(body: unknown, now: number): TemplateSet | null {
  const list = readTemplateList(body);
  if (list === null) return null;
  const items = list.map((template): PhoneTemplate => ({
    ...template,
    siteTypeHint: isSiteType(template.siteTypeHint) ? template.siteTypeHint : null,
  }));
  return { fetchedAt: now, items };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000) : 0;
const label = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null;

/** The stored document, read defensively: every element is checked again and only the allow-listed fields survive. */
export function parseStoredTemplates(raw: unknown): TemplateSet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as { fetchedAt?: unknown; items?: unknown };
  if (!Array.isArray(record.items) || typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt)) return null;
  const items: PhoneTemplate[] = [];
  for (const entry of (record.items as unknown[]).slice(0, MAX_STORED_TEMPLATES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e['id'] === 'string' && UUID.test(e['id']) ? e['id'] : null;
    const code = label(e['code'], 64);
    const name = label(e['name'], 200);
    if (id === null || code === null || name === null) continue;
    items.push({
      id,
      code,
      name,
      siteTypeHint: isSiteType(e['siteTypeHint']) ? e['siteTypeHint'] : null,
      itemCount: count(e['itemCount']),
      procedureCount: count(e['procedureCount']),
      milestoneCount: count(e['milestoneCount']),
    });
  }
  return { fetchedAt: record.fetchedAt, items };
}
