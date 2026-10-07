/** Public API of the `customers` module (other modules reach it only through this file — ADR-0001). */
export { CustomersModule } from './customers.module.ts';
export { CUSTOMER_EVENT_TYPES, type CustomerEvent } from './events.ts';
