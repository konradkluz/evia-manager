package pl.eviacharge.upload.runner

import pl.eviacharge.upload.AttentionReason
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.OriginalMissingException
import pl.eviacharge.upload.Outcome
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadEngine
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.files.JobFileGoneException
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenOwner

/** What the scheduler of the platform does after one run of a job. The glue only maps these to `jobFinished(wantsReschedule)`. */
sealed interface JobResult {
    /** The file is on the server; the original stays until the server says `clean` (the app decides, [pl.eviacharge.upload.files.OriginalPolicy]). */
    data object Finished : JobResult

    /** Try again later; [delayMs] is the wait the engine wants (backoff or `Retry-After`), `null` = the schedule decides. */
    data class Retry(
        val delayMs: Long?,
    ) : JobResult

    /** A video waits for a network without charges (EVM-110): not an error, no attention; the next run continues from the snapshot. */
    data object WaitingForWifi : JobResult

    /** `checksum_mismatch`: the snapshot was cleared, the original stays; the next run starts a new session ("Ponów"). */
    data object RetryChecksum : JobResult

    /** The work waits for a full sign-in of the same owner (`session_revoked`, no session) - the job is not rescheduled. */
    data object PausedForSignIn : JobResult

    /** The work waits for an update of the app (`426`) - the job is not rescheduled. */
    data object PausedForUpdate : JobResult

    /** The job belongs to another signed-in owner: nothing was sent, the job stays for its owner. */
    data object WrongOwner : JobResult

    /** The record stays and the user sees "Ponów" or an explanation; not rescheduled by itself. */
    data class NeedsAttention(
        val reason: AttentionReason,
    ) : JobResult

    /** The wipe marker is set or the server demanded the wipe: nothing is sent, the chain of the wipe takes over. */
    data object DeviceWipe : JobResult

    /** The job file or the original is gone (the wipe, the user): the job ends, no failure. */
    data object Dropped : JobResult

    /** The system stopped the job (`onStopJob`): the next run continues from the saved snapshot. */
    data object Stopped : JobResult
}

/**
 * One run of one job, as the worker does it, in pure Kotlin so that all decisions are tested on the JVM and the glue of Android only
 * calls it. The order: the wipe marker first, then the job file, then the owner (a job of another owner is refused, a paused session
 * works again only after a full sign-in of the same owner, SR-MOB-13), then the engine with a fresh instance for this run (one
 * thread, one instance per job). The engine's [newEngine] factory builds the adapters (API, part transport) of this job.
 */
class UploadJobRunner(
    private val jobs: JobFileStore,
    private val tokens: TokenOwner,
    private val marker: WipeMarker,
    private val newEngine: (JobFileData) -> UploadEngine,
    private val logger: RedactingLogger = RedactingLogger.NONE,
) {
    fun run(assetId: String): JobResult {
        if (marker.isStopped()) return JobResult.DeviceWipe
        val job = jobs.read(assetId) ?: return JobResult.Dropped
        gate(job)?.let { return it }
        // a job paused by `session_revoked` has an owner that signed in again (the gate above): this is the explicit resume
        val resume = job.snapshot?.state == JobState.PAUSED_REVOKED
        return try {
            map(newEngine(job).run(job.assetId, job.declaration, resume))
        } catch (error: UploadCancelledException) {
            if (marker.isStopped()) JobResult.DeviceWipe else JobResult.Stopped
        } catch (error: JobFileGoneException) {
            JobResult.Dropped
        } catch (error: OriginalMissingException) {
            JobResult.Dropped
        }
    }

    /** `null` = the owner may work; otherwise the result without any request. */
    private fun gate(job: JobFileData): JobResult? =
        when (tokens.state()) {
            SessionState.SIGNED_IN -> {
                if (tokens.mayWork(job.ownerId)) null else JobResult.WrongOwner
            }

            SessionState.WIPE_REQUIRED -> {
                JobResult.DeviceWipe
            }

            SessionState.PAUSED_UPDATE -> {
                JobResult.PausedForUpdate
            }

            // revoked, signed out or needs a sign-in: the state of the job is kept as paused, so that only an explicit resume starts it
            else -> {
                pause(job)
                JobResult.PausedForSignIn
            }
        }

    private fun pause(job: JobFileData) {
        val snapshot = job.snapshot ?: return
        if (snapshot.state == JobState.ACTIVE) jobs.save(snapshot.copy(state = JobState.PAUSED_REVOKED))
    }

    private fun map(outcome: Outcome): JobResult {
        logger.event("job_result", mapOf("outcome" to outcome.type))
        return when (outcome) {
            Outcome.Uploaded -> JobResult.Finished
            is Outcome.RetryLater -> JobResult.Retry(outcome.delayMs)
            Outcome.RetryChecksum -> JobResult.RetryChecksum
            Outcome.WaitingForWifi -> JobResult.WaitingForWifi
            Outcome.PausedRevoked -> JobResult.PausedForSignIn
            Outcome.PausedUpdate -> JobResult.PausedForUpdate
            Outcome.DeviceWipe -> JobResult.DeviceWipe
            is Outcome.NeedsAttention -> JobResult.NeedsAttention(outcome.reason)
        }
    }
}
