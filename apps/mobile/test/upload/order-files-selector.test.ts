import { filesOfOrder } from '../../src/upload/order-files';
import type { MediaFileView } from '../../src/upload/types';

const file = (assetId: string, patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId,
  workOrderId: 'o1',
  status: 'waiting',
  percent: null,
  sizeBytes: 1,
  actions: [],
  code: null,
  updatedAt: 1,
  category: null,
  mediaType: 'photo',
  capturedAt: 100,
  ...patch,
});

describe('the files of one order (EVM-111 AC1)', () => {
  it('EVM-111 AC1: only the files of the order; Wymaga uwagi, Nie wysłano, w toku, oczekujące (a film waiting for Wi-Fi is waiting); the newest first in a group, the id last (a stable order)', () => {
    const list = filesOfOrder(
      [
        file('b', { status: 'waiting' }),
        file('a', { status: 'waiting' }),
        file('c', { status: 'waiting_wifi', capturedAt: 300 }),
        file('d', { status: 'uploading', percent: 1 }),
        file('e', { status: 'error' }),
        file('f', { status: 'attention' }),
        file('g', { workOrderId: 'o2' }),
      ],
      'o1',
    );
    expect(list.map((item) => item.assetId)).toEqual(['f', 'e', 'd', 'c', 'a', 'b']);
  });

  it('EVM-111 AC1: an order with no file, and an unknown order, give an empty list - the input is not changed', () => {
    const input = [file('a'), file('b', { capturedAt: 5 })];
    expect(filesOfOrder(input, 'nothing')).toEqual([]);
    expect(filesOfOrder([], 'o1')).toEqual([]);
    expect(input.map((item) => item.assetId)).toEqual(['a', 'b']);
  });
});
