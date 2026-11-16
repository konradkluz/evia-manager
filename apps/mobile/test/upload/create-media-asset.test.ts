import {
  createCapturedPhotoInput,
  createCapturedVideoInput,
  createMediaAssetInput,
  DESCRIPTION_MAX,
  MEDIA_CATEGORIES,
  MEDIA_COMMAND_VERSION,
} from '../../src/upload/create-media-asset';

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

describe('the command of a captured photo (EVM-108 AC1; security 15)', () => {
  const photo = { assetId: ASSET, workOrderId: WO, category: 'defect' as const, capturedAt: '2026-11-15T08:00:00.000Z' };

  it('EVM-108 AC1: the payload is built explicitly with EXACTLY the keys id, workOrderId, mediaType, category, capturedAt', () => {
    const input = createCapturedPhotoInput(photo);
    expect(input).toEqual({
      type: 'CreateMediaAsset',
      commandVersion: MEDIA_COMMAND_VERSION,
      payload: { id: ASSET, workOrderId: WO, mediaType: 'photo', category: 'defect', capturedAt: '2026-11-15T08:00:00.000Z' },
    });
    expect(Object.keys(input?.payload ?? {}).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
  });

  it('EVM-108 AC1: extra fields of the argument (a description, a stage, a customer) never reach the payload', () => {
    const input = createCapturedPhotoInput({
      ...photo,
      description: 'SYNTHETIC-DESCRIPTION',
      procedureStageId: WO,
      customerName: 'SYNTHETIC-CUSTOMER',
    } as never);
    expect(Object.keys(input?.payload ?? {}).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
    expect(JSON.stringify(input)).not.toContain('SYNTHETIC');
  });

  it('EVM-108 AC1: a bad id, a category outside the list or a time that is not an ISO instant is refused', () => {
    expect(createCapturedPhotoInput({ ...photo, assetId: '10000000-0000-4000-8000-000000000001' })).toBeNull();
    expect(createCapturedPhotoInput({ ...photo, workOrderId: 'x' })).toBeNull();
    expect(createCapturedPhotoInput({ ...photo, category: 'holiday' as never })).toBeNull();
    for (const capturedAt of ['yesterday', '2026-11-15', '2026-11-15T08:00:00+01:00', '2026-13-45T08:00:00.000Z', '']) {
      expect(createCapturedPhotoInput({ ...photo, capturedAt })).toBeNull();
    }
  });
});

describe('the command of a recorded film (EVM-110 AC1; RR-96, SEC-110-09)', () => {
  const video = {
    assetId: ASSET,
    workOrderId: WO,
    category: 'defect' as const,
    capturedAt: '2026-11-15T08:00:00.000Z',
    durationMs: 133_400,
  };

  it('EVM-110 AC1: the payload is built explicitly with EXACTLY the keys id, workOrderId, mediaType (video), category, capturedAt - the length is not one of them', () => {
    const input = createCapturedVideoInput(video);
    expect(input).toEqual({
      type: 'CreateMediaAsset',
      commandVersion: MEDIA_COMMAND_VERSION,
      payload: { id: ASSET, workOrderId: WO, mediaType: 'video', category: 'defect', capturedAt: '2026-11-15T08:00:00.000Z' },
    });
    expect(Object.keys(input?.payload ?? {}).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
  });

  it('EVM-110 AC1: extra fields of the argument (a description, a stage, a customer, a path) never reach the payload', () => {
    const input = createCapturedVideoInput({
      ...video,
      description: 'SYNTHETIC-DESCRIPTION',
      procedureStageId: WO,
      customerName: 'SYNTHETIC-CUSTOMER',
      uri: 'file:///SYNTHETIC/path.mp4',
    } as never);
    expect(Object.keys(input?.payload ?? {}).sort()).toEqual(['capturedAt', 'category', 'id', 'mediaType', 'workOrderId']);
    expect(JSON.stringify(input)).not.toMatch(/SYNTHETIC|durationMs/);
  });

  it('EVM-110 AC1: a bad id, a category outside the list, a time that is not an ISO instant or a length that is not a whole non-negative number is refused', () => {
    expect(createCapturedVideoInput({ ...video, assetId: '10000000-0000-4000-8000-000000000001' })).toBeNull();
    expect(createCapturedVideoInput({ ...video, workOrderId: 'x' })).toBeNull();
    expect(createCapturedVideoInput({ ...video, category: 'holiday' as never })).toBeNull();
    for (const capturedAt of ['yesterday', '2026-11-15', '2026-11-15T08:00:00+01:00', '']) {
      expect(createCapturedVideoInput({ ...video, capturedAt })).toBeNull();
    }
    for (const durationMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createCapturedVideoInput({ ...video, durationMs })).toBeNull();
    }
    expect(createCapturedVideoInput({ ...video, durationMs: 0 })).not.toBeNull();
  });
});
