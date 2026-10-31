/**
 * The configuration of the mobile client that depends on the server (EVM-094 → `getClientConfig`; ADR-0021 D7). No personal data. In M2 the values are the
 * defaults of the decision (a window of 7 days without contact); N (the closed orders in scope), the period of the resync and the version of the rule of scope
 * are the settings of the server - the SAME values the pull uses (EVM-097 AC6: the version is derived from N, the counter of the operator and the set of types, so
 * a change of N reaches the phones as `scope_changed`); the minimum version is the one of the API settings (the same object `GET /api/health` shows), and the recommended one equals it until a release
 * policy says otherwise.
 */
export interface ClientVersionsPair {
  readonly android: string;
  readonly ios: string;
}

export interface ClientConfigValues {
  readonly offlineContactWindowDays: number;
  readonly closedWorkOrdersInScopeDays: number;
  readonly periodicResyncDays: number;
  readonly scopeRuleVersion: number;
  readonly minSupportedVersion: ClientVersionsPair;
  readonly recommendedVersion: ClientVersionsPair;
}

import { effectiveScopeRuleVersion } from '../../../platform/sync/scope-rule.ts';

export interface ClientSyncSettings {
  readonly closedOrdersInScopeDays: number;
  readonly periodicResyncDays: number;
  readonly scopeRuleVersion: number;
}

export const clientConfig = (minimum: ClientVersionsPair, sync: ClientSyncSettings): ClientConfigValues => ({
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: sync.closedOrdersInScopeDays,
  periodicResyncDays: sync.periodicResyncDays,
  scopeRuleVersion: effectiveScopeRuleVersion({ configured: sync.scopeRuleVersion, closedDays: sync.closedOrdersInScopeDays }),
  minSupportedVersion: { android: minimum.android, ios: minimum.ios },
  recommendedVersion: { android: minimum.android, ios: minimum.ios },
});
