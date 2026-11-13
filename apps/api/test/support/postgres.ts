/**
 * PostgreSQL of the integration tests (EVM-008 AC1; ADR-0003, ADR-0015) — the single source of the image and of the
 * initdb arguments. compose.yaml (service `postgres`) uses the same values; tools/repo-policy fails when they drift.
 * Renovate updates the digest; after an ICU change run ALTER COLLATION … REFRESH VERSION (runbook EVM-007).
 */
export const POSTGRES_IMAGE = 'postgres:18.6-trixie@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';

/** Polish collation for the whole cluster (sorting Ł after L; ADR-0003 → Polskie znaki). */
export const POSTGRES_INITDB_ARGS = '--locale-provider=icu --icu-locale=pl-PL';
