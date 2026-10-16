/**
 * The query of the list of users and the position of its cursor (EVM-024 AC5; W-16; SR-INPUT-01, SR-API-04): a strict schema — a `limit`
 * that is not 1..100 or a cursor that is not base64url within 512 characters is `400 validation_failed`, never a 500. The order is fixed (the
 * display name in the collation of the database, then the id); there is no `sort` parameter and no phrase.
 *
 * The position of a cursor is the identifier of the last user ONLY (a name can be 200 characters and would travel in the URL and the access
 * log); the reader resolves the sort key of that user itself.
 */
import { z } from 'zod';

export const DEFAULT_USER_LIMIT = 25;
export const MAX_USER_LIMIT = 100;

const listQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(MAX_USER_LIMIT))
    .optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export interface UserListQuery {
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveUserListQuery = listQuerySchema.transform((query): UserListQuery => ({
  limit: query.limit ?? DEFAULT_USER_LIMIT,
  cursor: query.cursor,
}));

const positionSchema = z.tuple([z.uuid()]);

/** @returns the identifier a cursor position holds, or undefined for a position that is not one (validated again after decryption) */
export function parseUserPosition(parts: readonly string[]): string | undefined {
  const parsed = positionSchema.safeParse(parts);
  return parsed.success ? parsed.data[0] : undefined;
}
