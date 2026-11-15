import { createMediaAssetInput, DESCRIPTION_MAX, MEDIA_CATEGORIES, MEDIA_COMMAND_VERSION } from '../../src/upload/create-media-asset';

const ASSET = '0194c2a0-0000-7000-8000-000000000001';
const WO = '10000000-0000-4000-8000-000000000001';
const base = { assetId: ASSET, workOrderId: WO, mediaType: 'photo' as const, category: 'other' as const };

describe('the command CreateMediaAsset (EVM-130 AC1; contract of EVM-131)', () => {
  it('EVM-130 AC1: the entry carries the contract payload only — no field of the server, no path, no digest', () => {
    expect(createMediaAssetInput(base)).toEqual({
      type: 'CreateMediaAsset',
      commandVersion: MEDIA_COMMAND_VERSION,
      payload: { id: ASSET, workOrderId: WO, mediaType: 'photo', category: 'other' },
    });
    expect(
      createMediaAssetInput({
        ...base,
        mediaType: 'video',
        category: 'defect',
        description: 'Synthetic description',
        procedureStageId: WO,
        capturedAt: '2026-11-15T08:00:00.000Z',
      }),
    ).toEqual({
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: {
        id: ASSET,
        workOrderId: WO,
        mediaType: 'video',
        category: 'defect',
        description: 'Synthetic description',
        procedureStageId: WO,
        capturedAt: '2026-11-15T08:00:00.000Z',
      },
    });
  });

  it('EVM-130 AC1: every category of the closed list is accepted', () => {
    for (const category of MEDIA_CATEGORIES) expect(createMediaAssetInput({ ...base, category })).not.toBeNull();
  });

  it.each([
    ['an id that is not a UUIDv7', { assetId: '10000000-0000-4000-8000-000000000001' }],
    ['a work order that is not a UUID', { workOrderId: 'x' }],
    ['a type outside photo and video', { mediaType: 'audio' as never }],
    ['a category outside the list', { category: 'selfie' as never }],
    ['a description above 1000 characters', { description: 'x'.repeat(DESCRIPTION_MAX + 1) }],
    ['a stage that is not a UUID', { procedureStageId: 'x' }],
    ['a time that is not a time', { capturedAt: 'yesterday' }],
  ])('EVM-130 AC1: %s is refused before it reaches the queue', (_name, patch) => {
    expect(createMediaAssetInput({ ...base, ...patch })).toBeNull();
  });
});
