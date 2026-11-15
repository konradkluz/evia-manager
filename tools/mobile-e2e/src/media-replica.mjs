// @ts-check
/**
 * The glue between the two parts of the scenario server that serve a file of the phone (EVM-130 stage C): the synchronization part
 * (sync-stub.mjs) answers `applied` to the command `CreateMediaAsset`, and the upload part (upload-stub.mjs) must then know the asset, or the
 * five operations of the session would answer `404`. The other direction: every change of the file state at the upload part becomes a change of
 * the replica `media_asset` (SyncMediaAsset of the contract, EVM-131), which the app reads on its next pull — the way the real server tells the
 * phone that the check of the file is over.
 *
 * Only synthetic data. The shapes follow the contract `SyncMediaAsset` (minimal projection: ids, type, category, the state of the file; the
 * description, size and times are `null`, the phone keeps its own values).
 */

/** The state of the replica for the state of the file at the upload part. */
const REPLICA_STATE = Object.freeze({
  pending_upload: 'pending',
  uploaded: 'uploading',
  // The contract says `clean`; the pull of @evia/sync-core reads only pending / uploading / processing / ready / failed today and skips an entity
  // with another value (the phone deletes the original after `clean` or `ready`, media-pipeline.md §1). `ready` keeps the scenario testable until
  // the pull learns `clean` and `quarantined` (open question in docs/qa/EVM-130).
  clean: 'ready',
  quarantined: 'quarantined',
  failed: 'failed',
});

/**
 * @param {{ assetId: string, workOrderId: string, mediaType: string, category: string | null, procedureStageId: string | null,
 *   version: number, state: keyof typeof REPLICA_STATE, reasonCode: string | null }} media
 */
export function mediaChange({ assetId, workOrderId, mediaType, category, procedureStageId, version, state, reasonCode }) {
  return {
    op: 'upsert',
    entity: {
      type: 'media_asset',
      id: assetId,
      version,
      workOrderId,
      mediaType,
      category,
      description: null,
      procedureStageId,
      capturedAt: null,
      fileState: REPLICA_STATE[state],
      fileStateReasonCode: state === 'failed' ? reasonCode : null,
      sizeBytes: null,
      durationSeconds: null,
      widthPx: null,
      heightPx: null,
    },
  };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
const asRecord = (value) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {});
/** @param {unknown} value @returns {string | null} */
const text = (value) => (typeof value === 'string' ? value : null);

/**
 * @param {{ registerAsset: (assetId: string, workOrderId: string) => boolean }} upload
 * @param {{ pushChanges: (changes: unknown[]) => void }} sync
 */
export function createMediaGlue(upload, sync) {
  /** @type {Map<string, { workOrderId: string, mediaType: string, category: string | null, procedureStageId: string | null, version: number }>} */
  const known = new Map();

  /**
   * @param {string} assetId
   * @param {keyof typeof REPLICA_STATE} state
   * @param {string | null} reasonCode
   */
  const publish = (assetId, state, reasonCode) => {
    const media = known.get(assetId);
    if (media === undefined) return;
    media.version += 1;
    sync.pushChanges([mediaChange({ assetId, ...media, state, reasonCode })]);
  };

  return {
    /**
     * The answer to a batch of mutations: every command `CreateMediaAsset` that was `applied` for the first time registers its asset at the upload
     * part and announces it to the replica as `pending`. A `duplicate`, a `rejected` or another type changes nothing.
     * @param {unknown} request the parsed body of `POST /sync/mutations`
     * @param {unknown} answer the parsed answer of the synchronization part
     */
    mutationsAnswered(request, answer) {
      const mutations = asRecord(request)['mutations'];
      const results = asRecord(answer)['results'];
      if (!Array.isArray(mutations) || !Array.isArray(results)) return;
      mutations.forEach((entry, index) => {
        const mutation = asRecord(entry);
        if (mutation['type'] !== 'CreateMediaAsset' || asRecord(results[index])['outcome'] !== 'applied') return;
        const payload = asRecord(mutation['payload']);
        const assetId = text(payload['id']);
        const workOrderId = text(payload['workOrderId']);
        if (assetId === null || workOrderId === null || known.has(assetId)) return;
        upload.registerAsset(assetId, workOrderId);
        known.set(assetId, {
          workOrderId,
          mediaType: text(payload['mediaType']) ?? 'photo',
          category: text(payload['category']),
          procedureStageId: text(payload['procedureStageId']),
          version: 0,
        });
        publish(assetId, 'pending_upload', null);
      });
    },

    /**
     * The upload part changed the file state of an asset.
     * @param {string} assetId @param {string} state @param {string | null} reasonCode
     */
    fileStateChanged(assetId, state, reasonCode) {
      if (state in REPLICA_STATE) publish(assetId, /** @type {keyof typeof REPLICA_STATE} */ (state), reasonCode);
    },
  };
}
