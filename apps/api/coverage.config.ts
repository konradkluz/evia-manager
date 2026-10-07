/**
 * Which run measures which source file (EVM-016; docs/process/testing-strategy.md → Progi). The API has two test runs:
 * the unit run (no database, everywhere: Windows, the container, cloud) and the integration run (PostgreSQL: the
 * `backend-tests` container, CI job backend-integration). Code whose behaviour is the SQL it runs — the use cases of a module,
 * its queries, the audit store, the alert outbox and the controllers that call them — can only be exercised against a real
 * database (locks, atomic UPDATE … RETURNING, grants, triggers: a fake would test the fake). Every source file is measured
 * by exactly one run, each with the backend threshold of 85% lines and branches; nothing is left out and no threshold is
 * lowered. The changed-code gate (coverage:diff) merges both runs.
 */
export const DATABASE_BOUND: readonly string[] = [
  'src/modules/identity/application/**/*.ts',
  'src/modules/identity/infrastructure/queries.ts',
  'src/modules/identity/infrastructure/tables.ts',
  'src/modules/identity/http/auth.controller.ts',
  'src/modules/catalog/application/**/*.ts',
  'src/modules/catalog/infrastructure/**/*.ts',
  'src/modules/catalog/http/catalog.controller.ts',
  'src/modules/audit/infrastructure/**/*.ts',
  'src/platform/alerts/**/*.ts',
  'src/cli/process-run.ts',
];
