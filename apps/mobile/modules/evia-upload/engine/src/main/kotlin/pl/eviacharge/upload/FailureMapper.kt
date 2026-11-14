package pl.eviacharge.upload

private val UPLOADED_STATES = setOf("uploaded", "scanning", "clean", "processing", "ready")

/** `422` of `complete`: the parts on the storage do not add up to the declared file (`upload_incomplete`, detail `size_mismatch` or `parts_missing`). */
internal val INCOMPLETE_CODES = setOf("upload_incomplete", "size_mismatch", "parts_missing")

private val UNKNOWN = Outcome.NeedsAttention(AttentionReason.UNKNOWN)

/**
 * Maps what the server or the network returned onto the state of the engine (EVM-109 AC2). Three kinds of input: an HTTP answer
 * (status and problem `code`), the file state after `complete`, and a network error. Anything unknown is `needs_attention(unknown)`.
 */
fun mapFailure(input: MappingInput): Outcome =
    when (input) {
        is Failure.Network -> Outcome.RetryLater()
        is FileState -> mapFileState(input)
        is Failure.Http -> mapHttp(input)
    }

private fun mapHttp(failure: Failure.Http): Outcome =
    when {
        failure.status == 401 -> {
            when (failure.code) {
                "session_revoked" -> Outcome.PausedRevoked
                "device_wipe_required" -> Outcome.DeviceWipe
                else -> UNKNOWN
            }
        }

        failure.status == 426 -> {
            Outcome.PausedUpdate
        }

        failure.status == 409 -> {
            when (failure.code) {
                "id_conflict" -> Outcome.NeedsAttention(AttentionReason.ID_CONFLICT)
                "invalid_state_transition" -> Outcome.NeedsAttention(AttentionReason.INVALID_STATE)
                else -> UNKNOWN
            }
        }

        failure.status == 422 && failure.code in INCOMPLETE_CODES -> {
            Outcome.NeedsAttention(AttentionReason.UPLOAD_INCOMPLETE)
        }

        failure.status == 429 -> {
            retryHint(failure.retryAfterSeconds)
        }

        failure.status >= 500 -> {
            Outcome.RetryLater()
        }

        else -> {
            UNKNOWN
        }
    }

/** The longest `Retry-After` taken into account (a day): a larger value is a mistake of the server or an attack on the schedule. */
internal const val MAX_RETRY_AFTER_SECONDS = 86_400L

private fun retryHint(seconds: Long?): Outcome =
    if (seconds == null || seconds < 0) Outcome.RetryLater() else Outcome.RetryLater(minOf(seconds, MAX_RETRY_AFTER_SECONDS) * 1000)

private fun mapFileState(file: FileState): Outcome =
    when {
        file.state in UPLOADED_STATES -> Outcome.Uploaded
        file.state == "quarantined" -> Outcome.NeedsAttention(AttentionReason.QUARANTINED)
        file.state == "failed" && file.reasonCode == "checksum_mismatch" -> Outcome.RetryChecksum
        else -> UNKNOWN
    }
