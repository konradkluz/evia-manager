/**
 * Module `customers` (ADR-0001, ADR-0017): the customers of the company; owner of the `customers` schema. In EVM-020 it serves the
 * search and the creation of a customer for the new-work-order form (W-05); the list, the detail, the edit and the deletion arrive
 * with EVM-039 – EVM-041. It depends on `platform` only (idempotency, rate limit, mass-read control, event bus); the audit trail
 * subscribes to its events (`customers` never imports `audit`). A facade for other modules (`CustomerDirectory`) comes with the first
 * consumer, EVM-022.
 */
import { Module } from '@nestjs/common';
import { CreateCustomerService } from './application/create-customer.service.ts';
import { SearchCustomersService } from './application/search-customers.service.ts';
import { CustomersController } from './http/customers.controller.ts';

@Module({ controllers: [CustomersController], providers: [SearchCustomersService, CreateCustomerService] })
export class CustomersModule {}
