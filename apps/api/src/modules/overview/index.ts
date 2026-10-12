/** Public API of the `overview` module (other modules reach it only through this file — ADR-0001). Nothing imports it but the composition root and the server command. */
export { OverviewModule } from './overview.module.ts';
export { ProjectionMaintenance, type RebuildReport, type VerifyReport } from './application/projection-maintenance.ts';
export { COLUMN_GROUPS, type ColumnGroup } from './domain/recompute.ts';
