package pl.eviacharge.upload.runner

import pl.eviacharge.upload.AttentionReason
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.notification.Notice
import pl.eviacharge.upload.notification.NotificationPlanner
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenOwner

/** Who hears about the work: the app (events) and the user (the notification). Implemented by the Android glue; it makes no decisions. */
interface UploadReporter {
    /** Throttled progress of a running file. */
    fun progress(status: JobStatus)

    /** A run ended: [result] says how; [session] is the state of the session when the run concerned it, else `null`. */
    fun finished(
        assetId: String,
        result: JobResult,
        session: SessionState?,
    )
}

/**
 * What the `JobService` does around one run, in pure Kotlin (the service only starts a thread and calls this): a run never throws
 * (an unexpected failure is `needs_attention(unknown)` and only the NAME of its class is logged, security 5), the tally of the failed
 * and the paused files for the notification, and the answer to `onStopJob`. Thread safe: several jobs of one service run at once.
 */
class UploadWorker(
    private val runner: UploadJobRunner,
    private val jobs: JobFileStore,
    private val running: RunningJobs,
    private val marker: WipeMarker,
    private val tokens: TokenOwner,
    private val reporter: UploadReporter,
    private val logger: RedactingLogger = RedactingLogger.NONE,
) {
    private val failed = LinkedHashSet<String>()
    private val paused = LinkedHashSet<String>()

    /** Registers the (not yet started) worker thread of the job; the stop that comes later reaches it through the handle. */
    fun begin(
        assetId: String,
        thread: Thread,
    ): CancelHandle = running.begin(assetId, thread)

    /** The thread of a job could not be started: its registration goes. */
    fun abandon(
        assetId: String,
        thread: Thread,
    ) = running.end(assetId, thread)

    /** Runs the job on the current thread (the one given to [begin]); never throws. */
    fun execute(assetId: String): JobResult {
        val thread = Thread.currentThread()
        try {
            val result =
                try {
                    runner.run(assetId)
                } catch (error: Throwable) {
                    logger.error("worker_failed", error)
                    JobResult.NeedsAttention(AttentionReason.UNKNOWN)
                }
            tally(assetId, result)
            running.end(assetId, thread)
            val session = if (JobOutcomes.concernsSession(result)) tokens.state() else null
            try {
                reporter.finished(assetId, result, session)
            } catch (error: RuntimeException) {
                logger.error("report_failed", error)
            }
            return result
        } finally {
            running.end(assetId, thread)
        }
    }

    /** `onStopJob`: stops the job; `true` = the system should schedule it again (not after the wipe). */
    fun onStop(assetId: String): Boolean {
        running.stop(assetId)
        return !marker.isStopped()
    }

    /** The file left the queue (cancelled by the user, confirmed by the server): it no longer counts as failed or paused. */
    @Synchronized
    fun forget(assetId: String) {
        failed.remove(assetId)
        paused.remove(assetId)
    }

    /** The notification for now; `null` = none. Counts come from the job files and the tally of this process. */
    fun notice(): Notice? {
        val all = jobs.list()
        val done = all.count { JobStatuses.of(it, false).state == FileJobState.UPLOADED }
        val (failedCount, isPaused) = synchronized(this) { failed.size to paused.isNotEmpty() }
        return NotificationPlanner.plan(all.size, done, failedCount, isPaused, running.count() > 0)
    }

    /** The status of every file on the native side. */
    fun statuses(): List<JobStatus> = jobs.list().map { JobStatuses.of(it, running.isRunning(it.assetId)) }

    @Synchronized
    private fun tally(
        assetId: String,
        result: JobResult,
    ) {
        failed.remove(assetId)
        paused.remove(assetId)
        when (result) {
            is JobResult.NeedsAttention -> failed.add(assetId)
            JobResult.PausedForSignIn, JobResult.PausedForUpdate -> paused.add(assetId)
            else -> Unit
        }
    }
}
