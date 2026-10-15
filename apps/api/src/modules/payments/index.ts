/** Public API of the `payments` module (other modules reach it only through this file — ADR-0001). */
export { PaymentsModule } from './payments.module.ts';
export {
  PAYMENT_MILESTONE_EVENT_TYPES,
  PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES,
  type PaymentMilestoneEvent,
  type PaymentMilestoneJournalEvent,
  type PaymentMilestoneRemovedEvent,
  type PaymentMilestoneStatusChangedEvent,
} from './events.ts';
export { PAYMENT_MILESTONE_DIRECTORY, type PaymentMilestoneDirectory } from './milestone-directory.ts';
