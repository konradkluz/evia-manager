package pl.eviacharge.upload.runner

import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.files.JobFileData

/** The state of one file on the native side, as the app shows it (the wire name goes to JavaScript). */
enum class FileJobState(
    val wire: String,
) {
    /** Armed, not running: waiting for the network, the scheduler or the next run. */
    QUEUED("queued"),
    UPLOADING("uploading"),
    UPLOADED("uploaded"),
    PAUSED_REVOKED("paused_revoked"),
}

/** Progress of one file: counters only (no address, no token). [percent] is 0..100. */
data class JobStatus(
    val assetId: String,
    val state: FileJobState,
    val partsDone: Int,
    val partCount: Int,
    val percent: Int,
    val sizeBytes: Long,
)

/** The pure mapping from the persisted job to what the status query and the throttled events report (no I/O). */
object JobStatuses {
    private const val PERCENT_FULL = 100

    fun of(
        data: JobFileData,
        running: Boolean,
    ): JobStatus = fromParts(data.assetId, data.size, data.snapshot, running)

    /** The status of the snapshot the engine just saved: the job runs. */
    fun ofSnapshot(snapshot: JobSnapshot): JobStatus = fromParts(snapshot.assetId, snapshot.size, snapshot, true)

    private fun fromParts(
        assetId: String,
        size: Long,
        snapshot: JobSnapshot?,
        running: Boolean,
    ): JobStatus {
        val total = snapshot?.partCount ?: 0
        val done = if (total > 0) minOf(snapshot?.etags?.size ?: 0, total) else 0
        val state =
            when {
                snapshot?.state == JobState.UPLOADED -> FileJobState.UPLOADED
                snapshot?.state == JobState.PAUSED_REVOKED -> FileJobState.PAUSED_REVOKED
                running -> FileJobState.UPLOADING
                else -> FileJobState.QUEUED
            }
        val percent =
            when {
                state == FileJobState.UPLOADED -> PERCENT_FULL
                total > 0 -> done * PERCENT_FULL / total
                else -> 0
            }
        return JobStatus(assetId, state, if (state == FileJobState.UPLOADED) total else done, total, percent, size)
    }
}
