/**
 * The query of the list of devices of the Administrator and the position of its cursor (EVM-095 AC2; W-17; SR-API-02, SR-INPUT-01): a strict schema - a `limit`
 * outside 1..100, a `userId` that is not a UUID, a `state` outside the closed list or a cursor that is not base64url within 512 characters is
 * `400 validation_failed`. The order is fixed (the last contact, newest first, then the identifier); there is no `sort` parameter.
 */
import { z } from 'zod';

export const DEFAULT_DEVICE_LIMIT = 50;
export const MAX_DEVICE_LIMIT = 100;

const listQuerySchema = z.strictObject({
  userId: z.uuid().optional(),
  state: z.enum(['active', 'signed_out', 'wipe_required', 'wiped']).optional(),
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(MAX_DEVICE_LIMIT))
    .optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export interface DeviceListQuery {
  readonly userId: string | undefined;
  readonly state: 'active' | 'signed_out' | 'wipe_required' | 'wiped' | undefined;
  readonly limit: number;
  readonly cursor: string | undefined;
}

export const resolveDeviceListQuery = listQuerySchema.transform((query): DeviceListQuery => ({
  userId: query.userId,
  state: query.state,
  limit: query.limit ?? DEFAULT_DEVICE_LIMIT,
  cursor: query.cursor,
}));

const positionSchema = z.tuple([z.iso.datetime({ offset: false }), z.uuid()]);

export interface DevicePosition {
  readonly lastContactAt: Date;
  readonly id: string;
}

export const devicePositionParts = (position: DevicePosition): string[] => [position.lastContactAt.toISOString(), position.id];

/** @returns the position a cursor holds, or undefined for one that is not a position (validated again after decryption) */
export function parseDevicePosition(parts: readonly string[]): DevicePosition | undefined {
  const parsed = positionSchema.safeParse(parts);
  return parsed.success ? { lastContactAt: new Date(parsed.data[0]), id: parsed.data[1] } : undefined;
}
