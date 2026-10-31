/**
 * The version of the rule of scope that the cursor and `GET /api/v1/meta/client-config` carry (EVM-097 AC6; ADR-0021 D1a, D7). It is DERIVED, so nobody has to
 * remember to raise it: a change of the number of days of the closed orders in scope (`N`), of the operator's counter (`SYNC_SCOPE_RULE_VERSION`) or of the set
 * of the entity types the pull serves ({@link SCOPE_TYPES_REVISION}) is a different number, and every cursor issued before it is a `resync_required`
 * with `scope_changed`. The number is an int32 (the cursor and the contract admit nothing larger) and it is never below the 1 of EVM-096.
 */
export const SCOPE_TYPES_REVISION = 2;

/** The bounds the configuration is validated against at the start (fail fast, ASVS V13): they keep the result inside an int32. */
export const MAX_SCOPE_RULE_COUNTER = 100_000;
export const MAX_CLOSED_DAYS = 365;

export interface ScopeRuleInputs {
  /** `SYNC_SCOPE_RULE_VERSION`, 1 … {@link MAX_SCOPE_RULE_COUNTER}. */
  readonly configured: number;
  /** `SYNC_CLOSED_ORDERS_IN_SCOPE_DAYS`, 1 … {@link MAX_CLOSED_DAYS}. */
  readonly closedDays: number;
}

export function effectiveScopeRuleVersion({ configured, closedDays }: ScopeRuleInputs): number {
  return ((configured - 1) * MAX_CLOSED_DAYS + (closedDays - 1)) * 10 + SCOPE_TYPES_REVISION;
}
