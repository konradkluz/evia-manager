/**
 * The answer of `createMediaAssetDownloadUrl` as the API client reads it (EVM-142 AC1; ADR-0004: only `src/api` imports the generated contract). The body is
 * validated with the schema of the contract; anything else is `null`. The address is a short-lived secret: it leaves this module to the viewer only, which keeps it
 * in a local variable for the one request and never in a state, a log or a name.
 */
import { zMediaDerivativeUrl } from '@evia/contracts/zod';

export interface DerivativeUrl {
  readonly url: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

export function readDerivativeUrl(body: unknown): DerivativeUrl | null {
  const parsed = zMediaDerivativeUrl.safeParse(body);
  if (!parsed.success) return null;
  const expiresAt = Date.parse(parsed.data.expiresAt);
  return Number.isFinite(expiresAt) ? { url: parsed.data.url, expiresAt } : null;
}
