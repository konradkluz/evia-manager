/**
 * "Pliki zlecenia" (EVM-111 AC1): the files of the phone's own queue that belong to one order, over the same snapshot as "Kolejka" - no new queue, no replica of
 * the media of the order (that one carries the files of other phones and of the panel too). The order of the id is the filter only: nothing here is shown.
 * Order of the list: needs attention, not sent, in progress, waiting (a film that waits for Wi-Fi is waiting too); inside a group the newest first.
 */
import type { MediaFileStatus, MediaFileView } from './types';

const RANK: Readonly<Record<MediaFileStatus, number>> = { attention: 0, error: 1, uploading: 2, waiting_wifi: 3, waiting: 3 };

export function filesOfOrder(files: readonly MediaFileView[], orderId: string): readonly MediaFileView[] {
  return files
    .filter((file) => file.workOrderId === orderId)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.capturedAt - a.capturedAt || (a.assetId < b.assetId ? -1 : 1));
}
