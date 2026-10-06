/** Migrations in order (Kysely Migrator, ADR-0003). Forward only: no `down` — a fix is a new migration. */
import type { Migration } from 'kysely/migration';
import * as foundation from './0001_foundation.ts';
import * as roles from './0002_roles.ts';
import * as audit from './0003_audit.ts';
import * as identity from './0004_identity.ts';
import * as securityAlerts from './0005_security_alerts.ts';

export const MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_foundation': foundation,
  '0002_roles': roles,
  '0003_audit': audit,
  '0004_identity': identity,
  '0005_security_alerts': securityAlerts,
});
