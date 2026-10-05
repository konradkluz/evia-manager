/**
 * Binds a route handler to an operation of the contract (`operationId`). The authorization guard takes the policy
 * of the operation from the contract manifest only — there is no local "public" decorator (ADR-0004, SR-AUTHZ-01).
 */
import { SetMetadata } from '@nestjs/common';

export const OPERATION_ID = 'evia:operationId';

export const OperationId = (operationId: string): MethodDecorator => SetMetadata(OPERATION_ID, operationId);
