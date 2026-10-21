/**
 * PostgreSQL of the integration tests (EVM-008 AC1; ADR-0003, ADR-0015) — the single source of the image and of the
 * initdb arguments. compose.yaml (service `postgres`) uses the same values; tools/repo-policy fails when they drift.
 * Renovate updates the digest; after an ICU change run ALTER COLLATION … REFRESH VERSION (runbook EVM-007).
 */
export const POSTGRES_IMAGE = 'postgres:18.6-trixie@sha256:1267c7e692de235fda2a50dbcdbcbca4672ea6a0298576a6bd9d07cafc319b32';

/** Polish collation for the whole cluster (sorting Ł after L; ADR-0003 → Polskie znaki). */
export const POSTGRES_INITDB_ARGS = '--locale-provider=icu --icu-locale=pl-PL';
