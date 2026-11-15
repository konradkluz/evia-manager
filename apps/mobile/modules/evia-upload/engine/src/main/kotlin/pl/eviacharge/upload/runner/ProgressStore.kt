package pl.eviacharge.upload.runner

import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.JobStore

/** At most one event per asset in [intervalMs] of the monotonic clock; a forced one (the end of a file, a pause) always passes. */
class ProgressThrottle(
    private val clock: () -> Long,
    private val intervalMs: Long = DEFAULT_INTERVAL_MS,
) {
    private val last = HashMap<String, Long>()

    @Synchronized
    fun allow(
        assetId: String,
        forced: Boolean,
    ): Boolean {
        val now = clock()
        val before = last[assetId]
        if (!forced && before != null && now - before in 0 until intervalMs) return false
        last[assetId] = now
        return true
    }

    companion object {
        const val DEFAULT_INTERVAL_MS = 1_000L
    }
}

/**
 * The [JobStore] of the engine with a side channel: after the snapshot is durably saved, the progress goes to [onStatus], throttled
 * (EVM-130: not more often than once a second; the end of a file always passes). The decorated store stays the truth; a failing
 * listener never fails the save.
 */
class ProgressStore(
    private val delegate: JobStore,
    private val throttle: ProgressThrottle,
    private val onStatus: (JobStatus) -> Unit,
) : JobStore by delegate {
    override fun save(snapshot: JobSnapshot) {
        delegate.save(snapshot)
        val status = JobStatuses.ofSnapshot(snapshot)
        val forced = snapshot.state != JobState.ACTIVE || (status.partCount > 0 && status.partsDone >= status.partCount)
        if (!throttle.allow(snapshot.assetId, forced)) return
        try {
            onStatus(status)
        } catch (error: RuntimeException) {
            // the app is not listening or failed: the upload goes on
        }
    }
}
