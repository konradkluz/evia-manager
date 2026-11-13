/**
 * The few constants and the parser of the e-mail settings that the configuration (`config.ts`) needs WITHOUT importing the adapters (which import the logger,
 * which imports the configuration: a cycle). EVM-089.
 */

export const RECIPIENT_MODES = ['lista', 'otwarty'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];

/** Fail closed: anything but the exact word `otwarty` (a missing, empty or unknown value) is `lista`. */
export function parseRecipientMode(raw: string | undefined): RecipientMode {
  return raw?.trim().toLowerCase() === 'otwarty' ? 'otwarty' : 'lista';
}

/** The domain verified in TEM, the ONLY domain of the sender (the configuration compares it exactly, on a label boundary). */
export const TEM_SENDER_DOMAIN = 'panel.eviacharge.pl';
