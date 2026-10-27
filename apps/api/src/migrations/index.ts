/** Migrations in order (Kysely Migrator, ADR-0003). Forward only: no `down` — a fix is a new migration. */
import type { Migration } from 'kysely/migration';
import * as foundation from './0001_foundation.ts';
import * as roles from './0002_roles.ts';
import * as audit from './0003_audit.ts';
import * as identity from './0004_identity.ts';
import * as securityAlerts from './0005_security_alerts.ts';
import * as login from './0006_login.ts';
import * as catalog from './0007_catalog.ts';
import * as catalogSeed from './0008_catalog_seed.ts';
import * as stepUp from './0009_step_up.ts';
import * as workOrders from './0010_work_orders.ts';
import * as customers from './0011_customers.ts';
import * as idempotency from './0012_idempotency.ts';
import * as parties from './0013_parties.ts';
import * as sites from './0014_sites.ts';
import * as workOrderCreation from './0015_work_order_creation.ts';
import * as workOrderStatus from './0016_work_order_status.ts';
import * as customerIndexes from './0017_customer_indexes.ts';
import * as siteOrdersIndex from './0018_site_orders_index.ts';
import * as procedures from './0019_procedures.ts';
import * as timeline from './0020_timeline.ts';
import * as timelineEvents from './0021_timeline_events.ts';
import * as scopeItemNotes from './0022_scope_item_notes.ts';
import * as overview from './0023_overview.ts';
import * as jobs from './0024_jobs.ts';
import * as workOrderSearchText from './0025_work_order_search_text.ts';
import * as payments from './0026_payments.ts';
import * as auditPaymentAmounts from './0027_audit_payment_amounts.ts';
import * as paymentMilestoneTransitions from './0028_payment_milestone_transitions.ts';
import * as auditStatusCodes from './0029_audit_status_codes.ts';
import * as paymentUnpaidIndex from './0030_payment_unpaid_index.ts';
import * as overviewPaymentSignals from './0031_overview_payment_signals.ts';
import * as idempotencyPurge from './0032_idempotency_purge.ts';
import * as deletedOrdersIndex from './0033_deleted_orders_index.ts';
import * as emailOutbox from './0035_email_outbox.ts';
import * as userInvitations from './0036_user_invitations.ts';
import * as passwordReset from './0037_password_reset.ts';
import * as totpAndRecoveryCodes from './0038_totp_and_recovery_codes.ts';
import * as userAccessManagement from './0039_user_access_management.ts';
import * as loginThrottle from './0040_login_throttle.ts';
import * as account from './0041_account.ts';
import * as media from './0045_media.ts';

export const MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_foundation': foundation,
  '0002_roles': roles,
  '0003_audit': audit,
  '0004_identity': identity,
  '0005_security_alerts': securityAlerts,
  '0006_login': login,
  '0007_catalog': catalog,
  '0008_catalog_seed': catalogSeed,
  '0009_step_up': stepUp,
  '0010_work_orders': workOrders,
  '0011_customers': customers,
  '0012_idempotency': idempotency,
  '0013_parties': parties,
  '0014_sites': sites,
  '0015_work_order_creation': workOrderCreation,
  '0016_work_order_status': workOrderStatus,
  '0017_customer_indexes': customerIndexes,
  '0018_site_orders_index': siteOrdersIndex,
  '0019_procedures': procedures,
  '0020_timeline': timeline,
  '0021_timeline_events': timelineEvents,
  '0022_scope_item_notes': scopeItemNotes,
  '0023_overview': overview,
  '0024_jobs': jobs,
  '0025_work_order_search_text': workOrderSearchText,
  '0026_payments': payments,
  '0027_audit_payment_amounts': auditPaymentAmounts,
  '0028_payment_milestone_transitions': paymentMilestoneTransitions,
  '0029_audit_status_codes': auditStatusCodes,
  '0030_payment_unpaid_index': paymentUnpaidIndex,
  '0031_overview_payment_signals': overviewPaymentSignals,
  '0032_idempotency_purge': idempotencyPurge,
  '0033_deleted_orders_index': deletedOrdersIndex,
  '0035_email_outbox': emailOutbox,
  '0036_user_invitations': userInvitations,
  '0037_password_reset': passwordReset,
  '0038_totp_and_recovery_codes': totpAndRecoveryCodes,
  '0039_user_access_management': userAccessManagement,
  '0040_login_throttle': loginThrottle,
  '0041_account': account,
  '0045_media': media,
});
