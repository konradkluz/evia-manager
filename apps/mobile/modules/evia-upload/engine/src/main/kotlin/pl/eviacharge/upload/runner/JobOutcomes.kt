package pl.eviacharge.upload.runner

import pl.eviacharge.upload.session.SessionState

/** What a finished run means for the system scheduler, for the app and for the session event: the decisions of the glue, tested here. */
object JobOutcomes {
    /** `jobFinished(wantsReschedule)`: only a run that can simply be continued asks the system to schedule it again. */
    fun wantsReschedule(result: JobResult): Boolean =
        when (result) {
            is JobResult.Retry, JobResult.RetryChecksum, JobResult.Stopped -> true
            else -> false
        }

    /** The wire state of the file after a run and an optional reason code (`needs_attention` and `checksum_mismatch` only). */
    fun fileState(result: JobResult): Pair<String, String?> =
        when (result) {
            JobResult.Finished -> "uploaded" to null
            is JobResult.Retry, JobResult.Stopped -> "queued" to null
            JobResult.RetryChecksum -> "queued" to "checksum_mismatch"
            JobResult.PausedForSignIn -> "paused_revoked" to null
            JobResult.PausedForUpdate -> "paused_update" to null
            JobResult.WrongOwner -> "wrong_owner" to null
            is JobResult.NeedsAttention -> "needs_attention" to result.reason.code
            JobResult.DeviceWipe -> "wiped" to null
            JobResult.Dropped -> "dropped" to null
        }

    /** `true` when the run says something about the session that the app must hear (the sign-in is needed, the update, the wipe). */
    fun concernsSession(result: JobResult): Boolean =
        result == JobResult.PausedForSignIn || result == JobResult.PausedForUpdate || result == JobResult.DeviceWipe

    fun sessionWire(state: SessionState): String =
        when (state) {
            SessionState.SIGNED_OUT -> "signed_out"
            SessionState.SIGNED_IN -> "signed_in"
            SessionState.NEEDS_LOGIN -> "needs_login"
            SessionState.PAUSED_REVOKED -> "paused_revoked"
            SessionState.PAUSED_UPDATE -> "paused_update"
            SessionState.WIPE_REQUIRED -> "wipe_required"
        }
}
