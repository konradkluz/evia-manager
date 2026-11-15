import type { MappingInput, Outcome } from './types.ts';

const UPLOADED_STATES: ReadonlySet<string> = new Set(['uploaded', 'scanning', 'clean', 'processing', 'ready']);

/** `422` of `complete`: the parts on the storage do not add up to the declared file (`upload_incomplete`, detail `size_mismatch` or `parts_missing`). */
export const INCOMPLETE_CODES: ReadonlySet<string> = new Set(['upload_incomplete', 'size_mismatch', 'parts_missing']);

/**
 * Maps what the server or the network returned onto the state of the engine (EVM-109 AC2). Three kinds of input: an HTTP answer
 * (status and problem `code`), the file state after `complete`, and a network error. Anything unknown is `needs_attention(unknown)`.
 */
export function mapFailure(input: MappingInput): Outcome {
  if (input.kind === 'network') return { type: 'retry_later' };
  if (input.kind === 'fileState') return mapFileState(input.state, input.reasonCode);
  const { status, code } = input;
  if (status === 401) {
    if (code === 'session_revoked') return { type: 'paused_revoked' };
    if (code === 'device_wipe_required') return { type: 'device_wipe' };
    return { type: 'needs_attention', reason: 'unknown' };
  }
  if (status === 426) return { type: 'paused_update' };
  if (status === 409) {
    if (code === 'id_conflict') return { type: 'needs_attention', reason: 'id_conflict' };
    if (code === 'invalid_state_transition') return { type: 'needs_attention', reason: 'invalid_state' };
    return { type: 'needs_attention', reason: 'unknown' };
  }
  if (status === 400 && code === 'validation_failed') return { type: 'needs_attention', reason: 'declaration_rejected' };
  if (status === 422 && code !== undefined && INCOMPLETE_CODES.has(code)) return { type: 'needs_attention', reason: 'upload_incomplete' };
  if (status === 429) return retryHint(input.retryAfterSeconds);
  if (status >= 500) return { type: 'retry_later' };
  return { type: 'needs_attention', reason: 'unknown' };
}

/** The longest `Retry-After` taken into account (a day): a larger value is a mistake of the server or an attack on the schedule. */
export const MAX_RETRY_AFTER_SECONDS = 86_400;

function retryHint(seconds: number | undefined): Outcome {
  if (seconds === undefined || !Number.isInteger(seconds) || seconds < 0) return { type: 'retry_later' };
  return { type: 'retry_later', delayMs: Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1000 };
}

function mapFileState(state: string, reasonCode: string | undefined): Outcome {
  if (UPLOADED_STATES.has(state)) return { type: 'uploaded' };
  if (state === 'quarantined') return { type: 'needs_attention', reason: 'quarantined' };
  if (state === 'failed' && reasonCode === 'checksum_mismatch') return { type: 'retry_checksum' };
  return { type: 'needs_attention', reason: 'unknown' };
}
