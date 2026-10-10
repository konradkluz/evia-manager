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
  'src/modules/identity/http/users.controller.ts',
  'src/modules/catalog/application/**/*.ts',
  'src/modules/catalog/infrastructure/**/*.ts',
  'src/modules/catalog/http/catalog.controller.ts',
  'src/modules/work-orders/application/**/*.ts',
  'src/modules/work-orders/infrastructure/**/*.ts',
  'src/modules/work-orders/http/work-orders.controller.ts',
  'src/modules/customers/application/**/*.ts',
  'src/modules/customers/infrastructure/**/*.ts',
  'src/modules/customers/http/customers.controller.ts',
  'src/modules/parties/application/**/*.ts',
  'src/modules/parties/infrastructure/**/*.ts',
  'src/modules/parties/http/parties.controller.ts',
  'src/modules/sites/application/**/*.ts',
  'src/modules/sites/infrastructure/**/*.ts',
  'src/modules/sites/http/sites.controller.ts',
  // the logic that touches no database (the answers, the names in batches, the controller over fake services) is measured by the unit run
  'src/modules/procedures/application/list-procedures.service.ts',
  'src/modules/procedures/application/update-stage.service.ts',
  'src/modules/procedures/application/transition-stage.service.ts',
  'src/modules/procedures/application/stage-answer.ts',
  'src/modules/procedures/application/procedures-contributor.ts',
  'src/modules/procedures/infrastructure/**/*.ts',
  'src/modules/audit/application/**/*.ts',
  'src/modules/audit/http/audit.controller.ts',
  'src/modules/audit/infrastructure/**/*.ts',
  'src/platform/alerts/**/*.ts',
  'src/platform/database/search-text.ts',
  'src/platform/idempotency/idempotency.ts',
  'src/cli/process-run.ts',
  // EVM-077: the development tools that read and write the local database (the guard in the database, the state, the demo data).
  'dev/administrator.ts',
  'dev/database-facts.ts',
  'dev/nest-seed.ts',
  'dev/run.ts',
];
