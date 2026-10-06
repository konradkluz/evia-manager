/**
 * PostgreSQL of the integration tests (EVM-008 AC1; ADR-0003, ADR-0015) — the single source of the image and of the
 * initdb arguments. compose.yaml (service `postgres`) uses the same values; tools/repo-policy fails when they drift.
 * Renovate updates the digest; after an ICU change run ALTER COLLATION … REFRESH VERSION (runbook EVM-007).
 */
export const POSTGRES_IMAGE = 'postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722';

/** Polish collation for the whole cluster (sorting Ł after L; ADR-0003 → Polskie znaki). */
export const POSTGRES_INITDB_ARGS = '--locale-provider=icu --icu-locale=pl-PL';
