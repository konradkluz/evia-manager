/**
 * The configuration of the mobile client that depends on the server (EVM-094 → `getClientConfig`; ADR-0021 D7). No personal data. In M2 the values are the
 * defaults of the decision (a window of 7 days without contact, 30 days of closed orders in scope, a periodic resync every 7 days, version 1 of the rule of
 * scope); the minimum version is the one of the API settings (the same object `GET /api/health` shows), and the recommended one equals it until a release
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

export const clientConfig = (minimum: ClientVersionsPair): ClientConfigValues => ({
  offlineContactWindowDays: 7,
  closedWorkOrdersInScopeDays: 30,
  periodicResyncDays: 7,
  scopeRuleVersion: 1,
  minSupportedVersion: { android: minimum.android, ios: minimum.ios },
  recommendedVersion: { android: minimum.android, ios: minimum.ios },
});
