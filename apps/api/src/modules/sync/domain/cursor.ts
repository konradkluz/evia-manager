/**
 * What the cursor of the pull carries and what the server makes of it (EVM-096 AC3, AC6; ADR-0021 D2, D6; SR-SYNC-07). The claims are positions and identifiers
 * - never personal data. `decideCursor` is the ONE mapping of every way a cursor can be unusable to its answer, so the table of cases is a single function:
 *
 * - the token is damaged under a known key (the tag does not match), or it opens but names another user or device -> `reject` (`400 invalid_cursor`, a security event);
 * - the token is not ours, names a key that left the ring, is expired, or the scope rule changed -> `resync` with the reason (`cursor_invalid`, `cursor_expired`,
 *   `scope_changed`); the device flag and the periodic control apply to the phase of changes only (a snapshot in progress IS the resync).
 */
import { z } from 'zod';
import type { KeyRingOpenResult } from '../../../platform/crypto/key-ring-cursor.ts';

export const RESYNC_REASONS = ['periodic', 'access_changed', 'scope_changed', 'cursor_expired', 'cursor_invalid'] as const;
export type ResyncReason = (typeof RESYNC_REASONS)[number];

/** Why a full download starts: a resync reason, the first download of the device, or a phone that simply asked again without a cursor. */
export type FullDownloadReason = ResyncReason | 'initial' | 'requested';

/** The closed set of reasons a cursor is rejected with `400` (the label of the metric). */
export type CursorRejection = 'tampered' | 'identity_mismatch';

const digits = z.string().regex(/^[0-9]{1,20}$/);

const common = { u: z.uuid(), d: z.uuid(), sv: z.int().min(1).max(1_000_000) };

/** Phase 1: the snapshot, paged by the aggregates (the orders) in the order of the identifier. `tx` is the horizon taken BEFORE the snapshot. */
const snapshotClaims = z.strictObject({
  ph: z.literal('snapshot'),
  tx: digits,
  after: z.uuid().nullable(),
  dl: z.uuid(),
  ...common,
});

/** Phase 2: the changes after the position `(tx, sq)` of the change log. */
const changesClaims = z.strictObject({ ph: z.literal('changes'), tx: digits, sq: digits, ...common });

export const cursorClaims = z.discriminatedUnion('ph', [snapshotClaims, changesClaims]);
export type CursorClaims = z.infer<typeof cursorClaims>;
export type SnapshotCursorClaims = z.infer<typeof snapshotClaims>;
export type ChangesCursorClaims = z.infer<typeof changesClaims>;

export interface DeviceSyncState {
  readonly lastFullSyncAt: Date | null;
  readonly resyncRequestedReason: ResyncReason | null;
}

export interface CursorContext {
  readonly userId: string;
  readonly deviceId: string;
  readonly scopeRuleVersion: number;
  readonly now: Date;
  readonly periodicResyncMs: number;
  readonly state: DeviceSyncState | undefined;
}

export type CursorDecision =
  | { readonly kind: 'proceed'; readonly claims: CursorClaims }
  | { readonly kind: 'reject'; readonly reason: CursorRejection }
  | { readonly kind: 'resync'; readonly reason: ResyncReason };

const resync = (reason: ResyncReason): CursorDecision => ({ kind: 'resync', reason });

export function decideCursor(opened: KeyRingOpenResult, context: CursorContext): CursorDecision {
  switch (opened.kind) {
    case 'tampered':
      return { kind: 'reject', reason: 'tampered' };
    case 'malformed':
    case 'unknown_key':
      return resync('cursor_invalid');
    case 'expired':
      return resync('cursor_expired');
    case 'ok':
      break;
  }
  const parsed = cursorClaims.safeParse(opened.claims);
  if (!parsed.success) return resync('cursor_invalid');
  const claims = parsed.data;
  if (claims.u !== context.userId || claims.d !== context.deviceId) return { kind: 'reject', reason: 'identity_mismatch' };
  if (claims.sv !== context.scopeRuleVersion) return resync('scope_changed');
  if (claims.ph === 'changes') {
    const { state } = context;
    if (state?.resyncRequestedReason != null) return resync(state.resyncRequestedReason);
    if (state?.lastFullSyncAt == null || context.now.getTime() - state.lastFullSyncAt.getTime() >= context.periodicResyncMs)
      return resync('periodic');
  }
  return { kind: 'proceed', claims };
}
