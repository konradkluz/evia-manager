/**
 * The photos of an order as "Zdjęcia zlecenia" shows them (EVM-142 AC2, AC6): built from the `media_asset` entities of the REPLICA (type, category, description, time
 * of the capture, state of the file - no name of a file, no address, no author), photos only (films: EVM-143), newest first. Pure code, no import of the store.
 */
import { MEDIA_CATEGORIES, type MediaCategory } from '../upload/create-media-asset';

/** One `media_asset` of the replica, allow-listed keys only (`readOrderPhotos`); `capturedAt` in ms. */
export interface OrderPhotoSource {
  readonly id: string;
  readonly category: string | null;
  readonly description: string | null;
  readonly capturedAt: number | null;
  readonly fileState: string;
}

/**
 * `ready` = a thumbnail and a preview exist; `preparing` = the server still works on the file (`processing`, `clean`, or a state this version does not know); `awaiting_file`
 * = the record is there and the file has not arrived (`pending`, `uploading`; a photo of a colleague that is still on its way, or one of this phone not yet confirmed).
 */
export type PhotoState = 'ready' | 'preparing' | 'quarantined' | 'failed' | 'awaiting_file';

export interface OrderPhoto {
  readonly id: string;
  /** `null` = no category, or a code of a newer version ("Bez kategorii"). */
  readonly category: MediaCategory | null;
  readonly description: string | null;
  /** The time of the capture (ms); for a record without it the time in the identifier (UUIDv7); `null` when neither is known. */
  readonly capturedAt: number | null;
  readonly state: PhotoState;
}

const STATE: Readonly<Record<string, PhotoState>> = {
  ready: 'ready',
  pending: 'awaiting_file',
  uploading: 'awaiting_file',
  processing: 'preparing',
  clean: 'preparing',
  quarantined: 'quarantined',
  failed: 'failed',
};

/** The millisecond time in the first 48 bits of a UUIDv7; `null` for any other identifier. */
export function timeOfUuidV7(id: string): number | null {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i.exec(id);
  if (match === null) return null;
  const at = Number.parseInt(`${match[1] ?? ''}${match[2] ?? ''}`, 16);
  return Number.isSafeInteger(at) ? at : null;
}

export function buildOrderPhotos(rows: readonly OrderPhotoSource[]): readonly OrderPhoto[] {
  const photos = rows.map<OrderPhoto>((row) => ({
    id: row.id,
    category: (MEDIA_CATEGORIES as readonly string[]).includes(row.category ?? '') ? (row.category as MediaCategory) : null,
    description: row.description === null || row.description.trim() === '' ? null : row.description,
    capturedAt: row.capturedAt ?? timeOfUuidV7(row.id),
    state: STATE[row.fileState] ?? 'preparing',
  }));
  // newest first; equal times keep a fixed order (the identifier is time-ordered), so the grid does not jump while it fills
  return photos.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
