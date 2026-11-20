// EVM-142 AC2, AC6: the photos of the order as the grid shows them - newest first, a fixed order for equal times, the state of the file as a state of the tile.
import { buildOrderPhotos, timeOfUuidV7, type OrderPhotoSource } from '../../src/orders/order-photos-model';

const ID = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, patch: Partial<OrderPhotoSource> = {}): OrderPhotoSource => ({
  id: ID(n),
  category: 'defect',
  description: null,
  capturedAt: 1_000 * n,
  fileState: 'ready',
  ...patch,
});

describe('order photos model (EVM-142)', () => {
  it('EVM-142 AC2: newest first by the time of the capture; equal times keep a fixed order (the identifier), whatever the order of the rows', () => {
    const a = buildOrderPhotos([row(1), row(3), row(2, { capturedAt: 3_000 })]).map((photo) => photo.id);
    const b = buildOrderPhotos([row(2, { capturedAt: 3_000 }), row(3), row(1)]).map((photo) => photo.id);
    expect(a).toEqual([ID(3), ID(2), ID(1)]);
    expect(b).toEqual(a);
  });

  it('EVM-142 AC2: every state of the file of the replica is one state of the tile; a state of a newer version is "preparing" (no request for an address)', () => {
    const state = (fileState: string) => buildOrderPhotos([row(1, { fileState })])[0]?.state;
    expect(state('ready')).toBe('ready');
    expect(state('processing')).toBe('preparing');
    expect(state('clean')).toBe('preparing');
    expect(state('quarantined')).toBe('quarantined');
    expect(state('failed')).toBe('failed');
    expect(state('pending')).toBe('awaiting_file');
    expect(state('uploading')).toBe('awaiting_file');
    expect(state('unknown')).toBe('preparing');
    expect(state('something_new')).toBe('preparing');
  });

  it('EVM-142 AC6: an unknown category is "no category"; a blank description is none; a missing time is the time of the UUIDv7 id', () => {
    const id = '0194c2a0-1234-7000-8000-000000000001';
    const [photo] = buildOrderPhotos([row(1, { category: 'invented', description: '   ', capturedAt: null, id })]);
    expect(photo?.category).toBeNull();
    expect(photo?.description).toBeNull();
    expect(photo?.capturedAt).toBe(timeOfUuidV7(id));
    expect(photo?.capturedAt).toBe(Number.parseInt('0194c2a01234', 16));
    expect(buildOrderPhotos([row(1, { category: 'measurement', description: 'Licznik' })])[0]).toMatchObject({
      category: 'measurement',
      description: 'Licznik',
    });
  });

  it('EVM-142 AC6: an identifier that is not a UUIDv7 gives no time (the tile shows the category only)', () => {
    expect(timeOfUuidV7('10000000-0000-4000-8000-000000000001')).toBeNull();
    expect(buildOrderPhotos([row(1, { id: '10000000-0000-4000-8000-000000000001', capturedAt: null })])[0]?.capturedAt).toBeNull();
  });

  it('EVM-142 AC2: rows without a category, a description or any time are kept - the ones without a time go last, equal ones in a fixed order', () => {
    const plain = '10000000-0000-4000-8000-0000000000aa';
    const other = '10000000-0000-4000-8000-0000000000bb';
    const photos = buildOrderPhotos([
      row(1, { id: plain, category: null, description: null, capturedAt: null }),
      row(2, { id: other, category: null, description: null, capturedAt: null }),
      row(3),
    ]);
    expect(photos.map((photo) => photo.id)).toEqual([ID(3), other, plain]);
    expect(photos[1]).toMatchObject({ category: null, description: null, capturedAt: null });
  });
});
