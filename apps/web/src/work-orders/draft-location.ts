import { EMPTY_LOCATION, type LocationState } from '../sites/location-section.tsx';

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasId = (value: unknown): boolean => value === null || (isObject(value) && typeof value.id === 'string');

/**
 * The section "Lokalizacja" as it was saved in a draft of W-05 (an order or a site survey share it: what was typed stays when the kind
 * of the form changes). A draft from before the section existed has none, a broken one is dropped (`undefined`).
 */
export function restoreLocation(value: unknown): LocationState | undefined {
  if (value === undefined) return EMPTY_LOCATION;
  if (!isObject(value) || (value.mode !== 'existing' && value.mode !== 'new') || !isObject(value.form)) return undefined;
  const form = value.form;
  if (!Object.keys(EMPTY_LOCATION.form).every((key) => typeof form[key] === 'string')) return undefined;
  if (!hasId(value.site) || !hasId(value.osd) || !hasId(value.manager)) return undefined;
  return value as unknown as LocationState;
}
