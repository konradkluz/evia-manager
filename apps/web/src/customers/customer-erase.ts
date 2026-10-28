import { anonymizeCustomer, deleteCustomer, getCustomer, restoreCustomer, type Client, type Customer } from '@evia/contracts';
import type { TFunction } from 'i18next';
import { StepUpCancelled } from '../administration/use-guarded-call.ts';
import { ApiError, unwrap } from '../api/client.ts';
import { uuidv7 } from './uuid.ts';

/** The three operations of an Administrator on a customer (EVM-041); the words of a failure depend on which one it was. */
export type EraseOperation = 'delete' | 'restore' | 'anonymize';

/** Why an operation did not go through (EVM-041 AC2, AC5, AC7, AC8); the answers carry no values of the customer. */
export type CustomerEraseFailure =
  | { readonly kind: 'dependents'; readonly count: number | undefined }
  | { readonly kind: 'rateLimited'; readonly minutes: number }
  | { readonly kind: 'registerDown' | 'server'; readonly code: string }
  | {
      readonly kind: 'conflict' | 'gone' | 'alreadyAnonymized' | 'busy' | 'notConfirmed' | 'forbidden' | 'network';
    };

/** A short code for the person to quote: the beginning of the trace id, or the stable code of the problem. */
const codeOf = (error: ApiError): string => error.traceId?.slice(0, 8) ?? error.code;

export function describeEraseFailure(error: unknown): CustomerEraseFailure {
  if (error instanceof StepUpCancelled) return { kind: 'notConfirmed' };
  if (!(error instanceof ApiError) || error.status === 0) return { kind: 'network' };
  if (error.status === 412 || error.status === 428) return { kind: 'conflict' };
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 409 && error.code === 'has_active_dependents') return { kind: 'dependents', count: error.openWorkOrders };
  if (error.status === 409 && (error.code === 'already_anonymized' || error.code === 'customer_anonymized')) {
    return { kind: 'alreadyAnonymized' };
  }
  if (error.status === 429) return { kind: 'rateLimited', minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) };
  if (error.status === 503 && error.code === 'deletion_register_unavailable') return { kind: 'registerDown', code: codeOf(error) };
  if (error.status === 503 && error.code === 'service_unavailable') return { kind: 'busy' };
  return { kind: 'server', code: codeOf(error) };
}

/** The words for a failure of `operation`; nothing of the customer is repeated in them. */
export function eraseFailureText(t: TFunction, operation: EraseOperation, failure: CustomerEraseFailure): string {
  switch (failure.kind) {
    case 'dependents':
      return operation === 'anonymize'
        ? t('customerErase.failure.dependents.anonymize', { count: failure.count ?? 0 })
        : t('customerErase.failure.dependents.delete', { count: failure.count ?? 0 });
    case 'rateLimited':
      return t('customerErase.failure.rateLimited', { minutes: failure.minutes });
    case 'registerDown':
      return t('customerErase.failure.registerDown', { code: failure.code });
    case 'server':
      return t('customerErase.failure.server', { code: failure.code });
    case 'conflict':
      return t('customerErase.failure.conflict');
    case 'gone':
      return t('customerErase.failure.gone');
    case 'alreadyAnonymized':
      return t('customerErase.failure.alreadyAnonymized');
    case 'busy':
      return t('customerErase.failure.busy');
    case 'notConfirmed':
      return t('customerErase.failure.notConfirmed');
    case 'forbidden':
      return t('customerErase.failure.forbidden');
    case 'network':
      return t('customerErase.failure.network');
  }
}

const etagOf = (version: number): string => `"${String(version)}"`;

/**
 * The strong ETag of the customer now: the Administrator reads a deleted customer too. A restore (the banner, or "Cofnij" right
 * after a delete) cannot guess the version the delete produced, so it is read just before; a missing header is a version that
 * cannot be trusted — the same as a conflict.
 */
export async function readCustomerEtag(client: Client, customerId: string): Promise<string> {
  const result = await getCustomer({ client, path: { customerId } });
  await unwrap(Promise.resolve(result));
  const etag = result.response?.headers.get('ETag') ?? null;
  if (etag === null || etag === '') throw new ApiError(412, { code: 'version_conflict' });
  return etag;
}

/** "Usuń klienta": the version on screen is the one the decision was made on (`412` when somebody changed the customer). */
export async function deleteCustomerRecord(client: Client, customer: Pick<Customer, 'id' | 'version'>): Promise<void> {
  await unwrap(
    deleteCustomer({
      client,
      path: { customerId: customer.id },
      headers: { 'If-Match': etagOf(customer.version), 'Idempotency-Key': uuidv7() },
    }),
  );
}

export async function restoreCustomerRecord(client: Client, customerId: string): Promise<Customer> {
  const etag = await readCustomerEtag(client, customerId);
  return unwrap(restoreCustomer({ client, path: { customerId }, headers: { 'If-Match': etag, 'Idempotency-Key': uuidv7() } }));
}

/** Without an `Idempotency-Key` (a repeat is `409 already_anonymized`, which the panel reads as "already done"). */
export async function anonymizeCustomerRecord(client: Client, customer: Pick<Customer, 'id' | 'version'>): Promise<Customer> {
  return unwrap(anonymizeCustomer({ client, path: { customerId: customer.id }, headers: { 'If-Match': etagOf(customer.version) } }));
}
