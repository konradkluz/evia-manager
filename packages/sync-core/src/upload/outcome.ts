import type { MappingInput, Outcome } from './types.ts';

const UPLOADED_STATES: ReadonlySet<string> = new Set(['uploaded', 'scanning', 'clean', 'processing', 'ready']);

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
  if (status === 429 || status >= 500) return { type: 'retry_later' };
  return { type: 'needs_attention', reason: 'unknown' };
}

function mapFileState(state: string, reasonCode: string | undefined): Outcome {
  if (UPLOADED_STATES.has(state)) return { type: 'uploaded' };
  if (state === 'quarantined') return { type: 'needs_attention', reason: 'quarantined' };
  if (state === 'failed' && reasonCode === 'checksum_mismatch') return { type: 'retry_checksum' };
  return { type: 'needs_attention', reason: 'unknown' };
}
