package pl.eviacharge.upload

private val UPLOADED_STATES = setOf("uploaded", "scanning", "clean", "processing", "ready")

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

        failure.status == 429 || failure.status >= 500 -> {
            Outcome.RetryLater()
        }

        else -> {
            UNKNOWN
        }
    }

private fun mapFileState(file: FileState): Outcome =
    when {
        file.state in UPLOADED_STATES -> Outcome.Uploaded
        file.state == "quarantined" -> Outcome.NeedsAttention(AttentionReason.QUARANTINED)
        file.state == "failed" && file.reasonCode == "checksum_mismatch" -> Outcome.RetryChecksum
        else -> UNKNOWN
    }
