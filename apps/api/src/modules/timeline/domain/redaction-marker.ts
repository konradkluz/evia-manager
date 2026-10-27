/**
 * The marker that replaces the text of a redacted entry (EVM-040 AC2; SR-PRIV-03): "Treść usunięta przez administratora DD.MM.RRRR." with the
 * calendar day in the business zone Europe/Warsaw (D8). Pure. {@link REDACTION_MARKER_PATTERN} is the ONE definition of the shape: the trigger
 * of migration 0042 holds the same anchored expression as defence in depth (without it a redaction would be a channel for editing a text), and a
 * test keeps the two equal.
 */
import { businessDate } from '../../../platform/clock/business-date.ts';

export const REDACTION_MARKER_PATTERN = /^Treść usunięta przez administratora [0-9]{2}\.[0-9]{2}\.[0-9]{4}\.$/;

/** @param instant the moment of the redaction (from the injected clock) */
export function redactionMarker(instant: Date): string {
  const [year, month, day] = businessDate(instant).split('-');
  return `Treść usunięta przez administratora ${day}.${month}.${year}.`;
}
