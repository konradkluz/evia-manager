package pl.eviacharge.upload.schedule

import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.files.FileDigest
import pl.eviacharge.upload.files.JobFileCodec
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.JobIdRegistry
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.UploadTypes
import java.io.IOException

/** One job of the system scheduler: the glue turns it into a `JobInfo` (persisted, with the network of [JobSpec]) without any decision. */
class JobRequest(
    val id: Int,
    val assetId: String,
    val spec: JobSpec,
    /** The bytes to send, for the estimate the system uses to give a user-initiated job enough time. */
    val uploadBytes: Long,
)

enum class ScheduleResult {
    SCHEDULED,

    /** The system refused a user-initiated job (`SecurityException`: the app is not visible enough); a regular job may still work. */
    REFUSED_USER_INITIATED,

    /** The system refused the job or the call failed. */
    FAILED,
}

/** The port to `JobScheduler`. */
interface SystemJobs {
    /** `true` while the job waits or runs (`JobScheduler.getPendingJob`). */
    fun isPending(id: Int): Boolean

    fun schedule(request: JobRequest): ScheduleResult

    fun cancel(id: Int)
}

/** The answer of [JobArming.arm]; none of them carries a path, a token or an address. */
sealed interface ArmResult {
    /** The job was handed to the system ([userInitiated] = UIDT, otherwise a regular job). */
    data class Armed(
        val userInitiated: Boolean,
    ) : ArmResult

    /** The system already has this job (it waits or runs): nothing was changed. */
    data object AlreadyArmed : ArmResult

    /** The original is not in the private directory (or is empty): the app must put it there first. */
    data object MissingOriginal : ArmResult

    /** An identifier of the wrong shape. */
    data object Invalid : ArmResult

    /** The wipe marker is set: nothing is armed. */
    data object WipeActive : ArmResult

    /** The job file, the id or the system refused: try again later. */
    data object Failed : ArmResult
}

/** The name of the answer for the app (JavaScript). */
fun ArmResult.wire(): String =
    when (this) {
        is ArmResult.Armed -> if (userInitiated) "armed_user_initiated" else "armed"
        ArmResult.AlreadyArmed -> "already_armed"
        ArmResult.MissingOriginal -> "missing_original"
        ArmResult.Invalid -> "invalid"
        ArmResult.WipeActive -> "wipe_active"
        ArmResult.Failed -> "failed"
    }

/**
 * Arming of a job after the server applied `CreateMediaAsset` (architect 7, EVM-130 AC1): idempotent - the job file and the system id
 * (the same after every restart) are kept, a job the system already has is not replaced (that would stop a running one). The kind of the
 * job is the pure [SchedulePolicy]; after a refused user-initiated job the same job is asked again as a regular one.
 */
class JobArming(
    private val files: UploadFiles,
    private val jobs: JobFileStore,
    private val ids: JobIdRegistry,
    private val system: SystemJobs,
    private val stop: StopCheck,
    private val apiLevel: Int,
    private val appVisible: () -> Boolean,
) {
    /** One file of the queue of the app that must have a job. */
    class Item(
        val assetId: String,
        val workOrderId: String,
        val userId: String,
        val deviceId: String,
        /** The type of the file as the app knows it; it must be (an alias of) a type of the allow-list of the contract. */
        val contentType: String,
    )

    fun arm(
        item: Item,
        wifiOnly: Boolean = false,
        force: Boolean = false,
    ): ArmResult {
        if (stop.isStopped()) return ArmResult.WipeActive
        val valid =
            UploadFiles.isAssetId(item.assetId) &&
                listOf(item.workOrderId, item.userId, item.deviceId).all { JobFileCodec.isIdentifier(it) }
        if (!valid) return ArmResult.Invalid
        val original = files.originalFile(item.assetId)
        val size = if (original.isFile) original.length() else 0L
        if (size <= 0L) return ArmResult.MissingOriginal
        val contentType = UploadTypes.normalize(item.contentType) ?: return ArmResult.Invalid
        val id =
            try {
                // the SHA-256 of the declaration is computed once, as a stream, before the first session; an existing job keeps its own
                if (jobs.read(item.assetId) == null) {
                    jobs.arm(
                        JobFileData(
                            item.assetId,
                            item.workOrderId,
                            size,
                            item.userId,
                            item.deviceId,
                            contentType,
                            FileDigest.sha256Hex(original),
                            null,
                        ),
                    )
                }
                ids.idFor(item.assetId)
            } catch (error: IOException) {
                return ArmResult.Failed
            } catch (error: IllegalStateException) {
                return ArmResult.Failed
            }
        if (!force && system.isPending(id)) return ArmResult.AlreadyArmed
        return submit(JobRequest(id, item.assetId, SchedulePolicy.decide(apiLevel, appVisible(), false, wifiOnly), size), wifiOnly)
    }

    /** The explicit retry ("Ponów"): the same job, owner and work order as armed before, handed to the system again even if it waits. */
    fun retry(
        assetId: String,
        wifiOnly: Boolean = false,
    ): ArmResult {
        if (!UploadFiles.isAssetId(assetId)) return ArmResult.Invalid
        val job = jobs.read(assetId) ?: return ArmResult.Invalid
        return arm(Item(job.assetId, job.workOrderId, job.userId, job.deviceId, job.contentType), wifiOnly, force = true)
    }

    /** Arms every file of the list (start of the app, return to the foreground, after a sign-in); the result of each. */
    fun reconcile(
        items: List<Item>,
        wifiOnly: Boolean = false,
    ): Map<String, ArmResult> = items.associate { it.assetId to arm(it, wifiOnly) }

    private fun submit(
        request: JobRequest,
        wifiOnly: Boolean,
    ): ArmResult =
        when (system.schedule(request)) {
            ScheduleResult.SCHEDULED -> {
                ArmResult.Armed(request.spec.userInitiated)
            }

            ScheduleResult.REFUSED_USER_INITIATED -> {
                val regular = SchedulePolicy.decide(apiLevel, appVisible(), userInitiatedRefused = true, wifiOnly = wifiOnly)
                if (system.schedule(JobRequest(request.id, request.assetId, regular, request.uploadBytes)) == ScheduleResult.SCHEDULED) {
                    ArmResult.Armed(false)
                } else {
                    ArmResult.Failed
                }
            }

            ScheduleResult.FAILED -> {
                ArmResult.Failed
            }
        }
}
