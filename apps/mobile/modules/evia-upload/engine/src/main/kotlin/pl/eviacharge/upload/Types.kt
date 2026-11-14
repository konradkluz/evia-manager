package pl.eviacharge.upload

/** In-process limits of one engine run; asserted against `packages/sync-core/conformance/upload/backoff.json` (EVM-109 AC4). */
object UploadLimits {
    const val MAX_ATTEMPTS = 4
    const val MAX_RENEWALS = 3
    const val BASE_DELAY_MS = 1000L
    const val CAP_DELAY_MS = 30_000L
    const val MAX_PARTS = 1000
}

/** Version of the persisted snapshot. An unknown version never crashes the engine: the job restarts through ListParts. */
const val SNAPSHOT_SCHEMA_VERSION = 1

/** What a port reports when a call did not succeed: an HTTP answer (`code` is the problem `code`) or no answer at all. */
sealed interface MappingInput

sealed interface Failure : MappingInput {
    data object Network : Failure

    data class Http(
        val status: Int,
        val code: String? = null,
    ) : Failure
}

/** State of the file after `complete` (`MediaAsset`: `state` and `stateReasonCode`). */
data class FileState(
    val state: String,
    val reasonCode: String? = null,
) : MappingInput

/** Thrown by ports (API, part transport); the message never carries an address or a token. */
class UploadFailure(
    val failure: Failure,
) : Exception(
        when (failure) {
            is Failure.Network -> "network"
            is Failure.Http -> "http ${failure.status}"
        },
    )

enum class AttentionReason(
    val code: String,
) {
    ID_CONFLICT("id_conflict"),
    QUARANTINED("quarantined"),
    PLAN_MISMATCH("plan_mismatch"),
    UNTRUSTED_PART_URL("untrusted_part_url"),
    INVALID_SERVER_RESPONSE("invalid_server_response"),
    INVALID_STATE("invalid_state"),
    URL_RENEWAL_EXHAUSTED("url_renewal_exhausted"),
    UNKNOWN("unknown"),
}

/** Result of a run (EVM-109 AC2). `type` is the wire name shared with the vectors. */
sealed class Outcome(
    val type: String,
) {
    data object Uploaded : Outcome("uploaded")

    data object PausedRevoked : Outcome("paused_revoked")

    data object DeviceWipe : Outcome("device_wipe")

    data object PausedUpdate : Outcome("paused_update")

    data class NeedsAttention(
        val reason: AttentionReason,
    ) : Outcome("needs_attention")

    data object RetryChecksum : Outcome("retry_checksum")

    /** `delayMs` is set by the engine (the delay the system schedule should respect); the mapping alone leaves it out. */
    data class RetryLater(
        val delayMs: Long? = null,
    ) : Outcome("retry_later")
}

/** Session as returned by the server: the server decides the split (fixed part size, the last part smaller, at most 1000 parts). */
data class SessionInfo(
    val id: String,
    val partSize: Long,
    val partCount: Int,
)

/** A part confirmed in storage (ListParts). No ETag: the server reads the parts itself at `complete`. */
data class RemotePart(
    val partNumber: Int,
    val size: Long,
)

/** Signed address of one part. Lives only in memory; `toString` never prints the address. */
class PartUrl(
    val url: String,
    val contentLength: Long,
) {
    override fun toString(): String = "PartUrl(contentLength=$contentLength)"
}

/** Request of one part: only allowlisted headers (`Content-Length`), never `Authorization`. `toString` never prints the address. */
class PartRequest(
    val url: String,
    val offset: Long,
    val length: Long,
    val headers: Map<String, String>,
) {
    override fun toString(): String = "PartRequest(offset=$offset, length=$length)"
}

/**
 * API host port. The adapter (EVM-130) refreshes the access token itself and repeats the call once; the engine gets `401` only after a
 * failed refresh, and a `401` with a code other than `session_revoked` or `device_wipe_required` becomes `needs_attention(unknown)`.
 * Every failure is thrown as [UploadFailure].
 */
interface UploadApi {
    fun createSession(
        assetId: String,
        sessionId: String,
        idempotencyKey: String,
    ): SessionInfo

    fun listParts(sessionId: String): List<RemotePart>

    fun partUrl(
        sessionId: String,
        partNumber: Int,
    ): PartUrl

    fun complete(sessionId: String): FileState
}

/**
 * Storage host port. Redirects are NOT followed (the adapter must disable them: a redirect could carry the part to another host).
 * Returns the ETag header when present (informational only). Failures are thrown as [UploadFailure].
 */
fun interface PartTransport {
    fun put(request: PartRequest): String?
}

/** Durable store of snapshots (EVM-130 backs it with the file queue). */
interface JobStore {
    fun load(assetId: String): JobSnapshot?

    fun save(snapshot: JobSnapshot)

    fun clear(assetId: String)
}

fun interface Sleeper {
    fun sleep(ms: Long)
}

fun interface RandomSource {
    /** Random number in [0, 1). */
    fun nextDouble(): Double
}

fun interface IdSource {
    /** New UUIDv7 (session id, idempotency key). */
    fun newId(): String
}

enum class Checkpoint { AFTER_SESSION, AFTER_PART_PUT, AFTER_PART_SAVED, BEFORE_COMPLETE, AFTER_COMPLETE_BEFORE_SAVE }

/** Test hook: throwing from here simulates the process being killed exactly at this point. */
fun interface CheckpointHook {
    fun reached(checkpoint: Checkpoint)
}
