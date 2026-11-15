/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- the replica changes are parsed JSON read by the assertions */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMediaGlue, mediaChange } from '../src/media-replica.mjs';

const ASSET = '01900000-0000-7000-8000-000000000002';
const WORK_ORDER = '30000000-0000-4000-8000-000000000001';

function setup() {
  /** @type {[string, string][]} */
  const registered = [];
  /** @type {any[]} */
  const pushed = [];
  const glue = createMediaGlue(
    {
      registerAsset: (assetId, workOrderId) => {
        registered.push([assetId, workOrderId]);
        return true;
      },
    },
    {
      pushChanges: (changes) => {
        pushed.push(...changes);
      },
    },
  );
  return { glue, registered, pushed };
}

const command = (/** @type {Record<string, unknown>} */ payload = {}) => ({
  mutations: [
    {
      mutationId: 'm-1',
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: { id: ASSET, workOrderId: WORK_ORDER, mediaType: 'photo', category: 'defect', ...payload },
    },
  ],
});

describe('media replica of the scenario server (EVM-130 AC1, AC4)', () => {
  it('EVM-130 AC1: the shape of a replica change is SyncMediaAsset of the contract (minimal projection)', () => {
    const change = mediaChange({
      assetId: ASSET,
      workOrderId: WORK_ORDER,
      mediaType: 'photo',
      category: 'other',
      procedureStageId: null,
      version: 3,
      state: 'failed',
      reasonCode: 'checksum_mismatch',
    });
    assert.deepEqual(change, {
      op: 'upsert',
      entity: {
        type: 'media_asset',
        id: ASSET,
        version: 3,
        workOrderId: WORK_ORDER,
        mediaType: 'photo',
        category: 'other',
        description: null,
        procedureStageId: null,
        capturedAt: null,
        fileState: 'failed',
        fileStateReasonCode: 'checksum_mismatch',
        sizeBytes: null,
        durationSeconds: null,
        widthPx: null,
        heightPx: null,
      },
    });
    // the reason is only for `failed`
    assert.equal(
      mediaChange({
        assetId: ASSET,
        workOrderId: WORK_ORDER,
        mediaType: 'photo',
        category: null,
        procedureStageId: null,
        version: 1,
        state: 'clean',
        reasonCode: 'checksum_mismatch',
      }).entity.fileStateReasonCode,
      null,
    );
  });

  it('EVM-130 AC1: `applied` registers the asset at the upload part once and announces it as `pending` (version 1)', () => {
    const { glue, registered, pushed } = setup();
    glue.mutationsAnswered(command(), { results: [{ mutationId: 'm-1', outcome: 'applied' }] });
    assert.deepEqual(registered, [[ASSET, WORK_ORDER]]);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].entity.fileState, 'pending');
    assert.equal(pushed[0].entity.version, 1);
    assert.equal(pushed[0].entity.category, 'defect');
    // the same command again (a retry of the batch): a duplicate, nothing new
    glue.mutationsAnswered(command(), { results: [{ mutationId: 'm-1', outcome: 'duplicate' }] });
    glue.mutationsAnswered(command(), { results: [{ mutationId: 'm-1', outcome: 'applied' }] });
    assert.equal(registered.length, 1);
    assert.equal(pushed.length, 1);
  });

  it('EVM-130 AC1: a rejected command, another type and a malformed batch change nothing', () => {
    const { glue, registered, pushed } = setup();
    glue.mutationsAnswered(command(), { results: [{ mutationId: 'm-1', outcome: 'rejected', code: 'validation_failed' }] });
    glue.mutationsAnswered(
      { mutations: [{ type: 'CreateNote', payload: { id: ASSET, workOrderId: WORK_ORDER } }] },
      { results: [{ outcome: 'applied' }] },
    );
    glue.mutationsAnswered(command({ id: 7 }), { results: [{ outcome: 'applied' }] });
    glue.mutationsAnswered(command({ workOrderId: null }), { results: [{ outcome: 'applied' }] });
    glue.mutationsAnswered(null, null);
    glue.mutationsAnswered({ mutations: [] }, { results: 'x' });
    assert.equal(registered.length + pushed.length, 0);
  });

  it('EVM-130 AC4: a change of the file state is a new version of the replica; unknown assets and states are ignored; clean is announced as ready', () => {
    const { glue, pushed } = setup();
    glue.fileStateChanged(ASSET, 'uploaded', null);
    assert.equal(pushed.length, 0);
    glue.mutationsAnswered(command({ mediaType: undefined, category: undefined }), { results: [{ outcome: 'applied' }] });
    glue.fileStateChanged(ASSET, 'uploaded', null);
    glue.fileStateChanged(ASSET, 'clean', null);
    glue.fileStateChanged(ASSET, 'quarantined', null);
    glue.fileStateChanged(ASSET, 'failed', 'checksum_mismatch');
    glue.fileStateChanged(ASSET, 'teleported', null);
    assert.deepEqual(
      pushed.map((change) => [change.entity.version, change.entity.fileState, change.entity.fileStateReasonCode]),
      [
        [1, 'pending', null],
        [2, 'uploading', null],
        [3, 'ready', null],
        [4, 'quarantined', null],
        [5, 'failed', 'checksum_mismatch'],
      ],
    );
    // a command without type and category falls back to a photo without category
    assert.equal(pushed[0].entity.mediaType, 'photo');
    assert.equal(pushed[0].entity.category, null);
  });
});
