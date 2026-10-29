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
  // EVM-023: the conditional UPDATEs of the TOTP factor and of the recovery codes (single use, replay guard) — SQL against PostgreSQL
  'src/modules/identity/infrastructure/mfa-queries.ts',
  // EVM-027: the administration of accounts — the count under the advisory lock, the managed changes with `version + 1`, the window of a second step, the deletion of credentials: SQL against PostgreSQL
  'src/modules/identity/infrastructure/access-queries.ts',
  // EVM-026: the counters against guessing (FOR UPDATE, ON CONFLICT, the retention) and the register of known browsers — SQL against PostgreSQL
  'src/modules/identity/infrastructure/throttle-queries.ts',
  'src/modules/identity/infrastructure/tables.ts',
  // EVM-094: the register of mobile devices and the tokens of a phone — locks, conditional UPDATEs, and joins that read the session, the account and the device on every request: SQL against PostgreSQL
  'src/modules/identity/infrastructure/device-queries.ts',
  'src/modules/identity/infrastructure/mobile-token-queries.ts',
  'src/modules/identity/http/mobile.controller.ts',
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
  'src/modules/procedures/application/procedures-scope-participant.ts',
  'src/modules/procedures/application/stage-directory.service.ts',
  // EVM-042: the addition, the deletion and the restoration of a process or a stage — locks, the places under a unique index that cannot be
  // deferred, ON CONFLICT, the events in the transaction of the command: SQL against PostgreSQL
  'src/modules/procedures/application/create-procedure.service.ts',
  'src/modules/procedures/application/create-stage.service.ts',
  'src/modules/procedures/application/delete-procedure.service.ts',
  'src/modules/procedures/application/delete-stage.service.ts',
  'src/modules/procedures/application/restore-procedure.service.ts',
  'src/modules/procedures/application/restore-stage.service.ts',
  'src/modules/procedures/application/list-deleted.service.ts',
  'src/modules/procedures/application/manual-shared.ts',
  'src/modules/procedures/infrastructure/**/*.ts',
  // the shape of the answers and the controller over fake services are measured by the unit run
  'src/modules/timeline/application/create-entry.service.ts',
  'src/modules/timeline/application/list-entries.service.ts',
  'src/modules/timeline/application/read-entry.service.ts',
  // EVM-040: the deletion, the restoration and the redaction - locks, conditional UPDATEs on the version, the trigger of the database
  'src/modules/timeline/application/delete-entry.service.ts',
  'src/modules/timeline/application/restore-entry.service.ts',
  'src/modules/timeline/application/redact-entry.service.ts',
  'src/modules/timeline/application/entry-page.ts',
  'src/modules/timeline/infrastructure/**/*.ts',
  // EVM-034: the read model — the recomputation, the handlers, rebuild/verify and the list are SQL against the projection; the pure
  // function of the projection and the query of the list (domain/) and the controller over fake services are measured by the unit run
  // EVM-053: the payment milestones — the use cases, the ports of the order (contributor, participant), the queries and the one point
  // of write are SQL against PostgreSQL (locks, ON CONFLICT, CHECKs); the domain (money, rules, plan) is measured by the unit run
  'src/modules/payments/application/**/*.ts',
  'src/modules/payments/infrastructure/**/*.ts',
  'src/modules/payments/http/payments.controller.ts',
  // EVM-044: the media - the use cases (locks, the chain order -> medium -> file -> session in one statement, compare-and-set of the state), the queries
  // and the controller are SQL against PostgreSQL; the rules of the domain (file rules, plan of the upload, verdicts) are measured by the unit run
  'src/modules/media/application/**/*.ts',
  'src/modules/media/infrastructure/**/*.ts',
  // EVM-096: the pull of changes - the transactions (READ ONLY and the full download under a lock), the queries on the change log and the horizon, the controller; the domain (cursor decisions, assembly of a page, projections) is measured by the unit run
  'src/modules/sync/application/**/*.ts',
  'src/modules/sync/infrastructure/**/*.ts',
  'src/modules/sync/http/sync.controller.ts',
  'src/modules/media/http/media.controller.ts',
  'src/modules/overview/application/**/*.ts',
  'src/modules/overview/infrastructure/**/*.ts',
  'src/modules/audit/application/**/*.ts',
  'src/modules/audit/http/audit.controller.ts',
  'src/modules/audit/infrastructure/**/*.ts',
  'src/platform/alerts/**/*.ts',
  // EVM-024: the outbox of e-mails, the relay to the queue and the job that sends — locks (FOR UPDATE, SKIP LOCKED), conditional UPDATEs and the order of
  // transactions: SQL against PostgreSQL; the port, the address, the guard, the SMTP adapter and the health file are unit tests
  'src/platform/email/email-outbox.ts',
  'src/platform/email/email-relay.ts',
  'src/platform/email/send-email.job.ts',
  // EVM-034 step 9: the adapter of the job queue over pg-boss, the script runner of the migration 0024 and the wiring of the worker
  // need the real database (grants, DDL refused for the application role); the queue interface, the handler and the run are unit tests
  'src/platform/jobs/pg-boss-job-queue.ts',
  'src/platform/database/script.ts',
  'src/migrations/0024_jobs.ts',
  'src/worker/worker-process.ts',
  'src/platform/database/search-text.ts',
  'src/platform/idempotency/idempotency.ts',
  'src/platform/idempotency/idempotency-purger.ts',
  'src/cli/process-run.ts',
  'src/cli/overview-process.ts',
  // EVM-077: the development tools that read and write the local database (the guard in the database, the state, the demo data).
  'dev/administrator.ts',
  'dev/database-facts.ts',
  'dev/nest-seed.ts',
  'dev/run.ts',
];
