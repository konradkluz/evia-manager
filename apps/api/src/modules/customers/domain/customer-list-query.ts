/**
 * The query of the list of customers and the position of its cursor (EVM-039 AC1; SR-INPUT-01, SR-INPUT-03, SR-API-04; ASVS V2.2.1,
 * V14.2.1; CWE-598): a strict schema — a `limit` that is not 1..100 or a cursor that is not base64url within 512 characters is
 * `400 validation_failed`, never a 500. The order is fixed (the sort key, then the id); there is no `sort` parameter and no phrase.
 *
 * The position of a cursor is the identifier of the last customer ONLY: a cursor holds no name (a name can be 400 characters, does
 * not fit a cursor and would travel in the URL and in the access log); the reader resolves the sort key of that customer itself.
 */
import { z } from 'zod';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const customerListQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(MAX_LIMIT))
    .optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

/** The query as the reader needs it: defaults applied. */
export interface CustomerListQuery {
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveCustomerListQuery = customerListQuerySchema.transform((query): CustomerListQuery => ({
  limit: query.limit ?? DEFAULT_LIMIT,
  cursor: query.cursor,
}));

const positionSchema = z.tuple([z.uuid()]);

/** @returns the identifier a cursor position holds, or undefined for a position that is not one (validated again after decryption) */
export function parsePosition(parts: readonly string[]): string | undefined {
  const parsed = positionSchema.safeParse(parts);
  return parsed.success ? parsed.data[0] : undefined;
}

/** The position of the last item of a page for the cursor of the next one. */
export const positionParts = (id: string): string[] => [id];
