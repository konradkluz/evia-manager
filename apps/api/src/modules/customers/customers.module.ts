/**
 * Module `customers` (ADR-0001, ADR-0017): the customers of the company; owner of the `customers` schema. In EVM-020 it serves the
 * search and the creation of a customer for the new-work-order form (W-05); EVM-039 adds the list, the detail and the edit (W-14);
 * EVM-041 adds the deletion, the restoration and the anonymization (Administrator; the dependents are asked through the port `CustomerDependentsRegistry`, which `work-orders` fills). It depends on `platform` only (idempotency, rate limit, mass-read control, event bus, the register of deletions); the audit trail
 * subscribes to its events (`customers` never imports `audit`). The facade `CustomerDirectory` serves `work-orders` (EVM-022): it
 * tells whether a customer exists and is visible to the caller, in the transaction of the caller.
 */
import { Module } from '@nestjs/common';
import { AnonymizeCustomerService } from './application/anonymize-customer.service.ts';
import { CreateCustomerService } from './application/create-customer.service.ts';
import { CustomerDirectoryService } from './application/customer-directory.service.ts';
import { CustomerPagesService } from './application/customer-pages.service.ts';
import { DeleteCustomerService } from './application/delete-customer.service.ts';
import { ListCustomersService } from './application/list-customers.service.ts';
import { ReadCustomerService } from './application/read-customer.service.ts';
import { RestoreCustomerService } from './application/restore-customer.service.ts';
import { UpdateCustomerService } from './application/update-customer.service.ts';
import { SearchCustomersService } from './application/search-customers.service.ts';
import { CUSTOMER_DIRECTORY } from './customer-directory.ts';
import { CustomerSyncSourceService } from './infrastructure/sync-source.ts';
import { CustomerQuickCreationService } from './application/customer-quick-creation.service.ts';
import { CUSTOMER_QUICK_CREATION, CUSTOMER_SYNC_SOURCE } from './system-ports.ts';
import { CustomerDependentsRegistry } from './dependents-guard.ts';
import { CustomersController } from './http/customers.controller.ts';

@Module({
  controllers: [CustomersController],
  providers: [
    { provide: CUSTOMER_SYNC_SOURCE, useClass: CustomerSyncSourceService },
    { provide: CUSTOMER_QUICK_CREATION, useClass: CustomerQuickCreationService },
    CustomerPagesService,
    SearchCustomersService,
    ListCustomersService,
    ReadCustomerService,
    CreateCustomerService,
    UpdateCustomerService,
    DeleteCustomerService,
    RestoreCustomerService,
    AnonymizeCustomerService,
    CustomerDependentsRegistry,
    { provide: CUSTOMER_DIRECTORY, useClass: CustomerDirectoryService },
  ],
  exports: [CUSTOMER_DIRECTORY, CustomerDependentsRegistry, CUSTOMER_SYNC_SOURCE, CUSTOMER_QUICK_CREATION],
})
export class CustomersModule {}
