package pl.eviacharge.upload.files

import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobStore
import pl.eviacharge.upload.Json
import pl.eviacharge.upload.JsonException
import java.io.IOException

/** The job file is gone (the wipe removed it, the user deleted the entry): the job ends without a failure and without a path in a log. */
class JobFileGoneException : RuntimeException("job file gone") {
    override fun fillInStackTrace(): Throwable = this
}

/** `userId:deviceId`: who owns the work. Both are server identifiers (UUID); the colon cannot be part of either. */
object OwnerId {
    fun of(
        userId: String,
        deviceId: String,
    ): String = "$userId:$deviceId"
}

/**
 * What the native side persists about one file to send: identifiers, sizes, counters and ETags only (SR-MOB-01). No token, no address,
 * no path, no file name and no description. [snapshot] is the state of the engine; `null` until the first run.
 */
data class JobFileData(
    val assetId: String,
    val workOrderId: String,
    val size: Long,
    val userId: String,
    val deviceId: String,
    val snapshot: JobSnapshot?,
) {
    val ownerId: String get() = OwnerId.of(userId, deviceId)
}

private val IDENTIFIER = Regex("^[A-Za-z0-9-]{1,64}$")
private val ETAG = Regex("^[A-Za-z0-9\"\\-_=+/.]{1,128}$")
private val PART_NUMBER = Regex("^[0-9]{1,4}$")
private const val MAX_FILE_BYTES = 256 * 1024

/** Serialization of [JobFileData]: the keys are an allowlist, in both directions (an unknown key makes the file unreadable). */
object JobFileCodec {
    const val FILE_SCHEMA_VERSION = 1

    /** An identifier of the server (UUID, `-` and alphanumerics, at most 64 characters): the only shape allowed in a job file. */
    fun isIdentifier(value: String): Boolean = IDENTIFIER.matches(value)

    val FIELD_NAMES = setOf("fileSchemaVersion", "assetId", "workOrderId", "size", "userId", "deviceId", "snapshot")

    fun encode(data: JobFileData): ByteArray {
        val fields =
            linkedMapOf<String, Any?>(
                "fileSchemaVersion" to FILE_SCHEMA_VERSION,
                "assetId" to data.assetId,
                "workOrderId" to data.workOrderId,
                "size" to data.size,
                "userId" to data.userId,
                "deviceId" to data.deviceId,
                "snapshot" to data.snapshot?.toFields(),
            )
        return Json.stringify(fields).toByteArray(Charsets.UTF_8)
    }

    /**
     * `null` when the file is not recognised: bad JSON, an unknown version, an unknown or missing key, an identifier of the wrong shape.
     * A snapshot of the engine that does not fit is dropped (the job restarts through ListParts), the header is kept.
     */
    fun decode(bytes: ByteArray): JobFileData? {
        val fields =
            try {
                Json.obj(Json.parse(String(bytes, Charsets.UTF_8)))
            } catch (error: JsonException) {
                return null
            } catch (error: ClassCastException) {
                return null
            }
        if (fields.keys != FIELD_NAMES || fields["fileSchemaVersion"] != FILE_SCHEMA_VERSION.toLong()) return null
        val assetId = identifier(fields["assetId"])?.takeIf { UploadFiles.isAssetId(it) } ?: return null
        val size = (fields["size"] as? Long)?.takeIf { it >= 0 } ?: return null
        return JobFileData(
            assetId = assetId,
            workOrderId = identifier(fields["workOrderId"]) ?: return null,
            size = size,
            userId = identifier(fields["userId"]) ?: return null,
            deviceId = identifier(fields["deviceId"]) ?: return null,
            snapshot = snapshot(fields["snapshot"], assetId),
        )
    }

    private fun identifier(value: Any?): String? = (value as? String)?.takeIf { IDENTIFIER.matches(it) }

    private fun snapshot(
        value: Any?,
        assetId: String,
    ): JobSnapshot? {
        val fields = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return null
        if (fields.keys != JobSnapshot.FIELD_NAMES) return null
        val snapshot = JobSnapshot.fromFields(fields) ?: return null
        val valid =
            snapshot.assetId == assetId &&
                IDENTIFIER.matches(snapshot.uploadSessionId) &&
                IDENTIFIER.matches(snapshot.idempotencyKey) &&
                snapshot.etags.all { PART_NUMBER.matches(it.key) && ETAG.matches(it.value) }
        return if (valid) snapshot else null
    }
}

/**
 * The queue of files on the native side: one file per job in `jobs/`, written atomically. It is the [JobStore] of the engine; the owner
 * and the work order stay as armed. Nothing here talks to the network and nothing logs.
 */
class JobFileStore(
    private val files: UploadFiles,
) : JobStore {
    /** Idempotent: an existing job of this asset is kept as it is (its progress and owner), and returned. */
    @Throws(IOException::class)
    fun arm(data: JobFileData): JobFileData {
        read(data.assetId)?.let { return it }
        write(data)
        return data
    }

    fun read(assetId: String): JobFileData? = AtomicFiles.read(files.jobFile(assetId), MAX_FILE_BYTES)?.let { JobFileCodec.decode(it) }

    /** Every readable job; an unreadable file is skipped. */
    fun list(): List<JobFileData> =
        files.jobsDirectory
            .listFiles { file -> file.isFile && file.name.endsWith(".json") }
            .orEmpty()
            .sortedBy { it.name }
            .mapNotNull { AtomicFiles.read(it, MAX_FILE_BYTES)?.let { bytes -> JobFileCodec.decode(bytes) } }

    override fun load(assetId: String): JobSnapshot? = read(assetId)?.snapshot

    override fun save(snapshot: JobSnapshot) {
        val current = read(snapshot.assetId) ?: throw JobFileGoneException()
        write(current.copy(snapshot = snapshot))
    }

    override fun clear(assetId: String) {
        val current = read(assetId) ?: throw JobFileGoneException()
        write(current.copy(snapshot = null))
    }

    /** The job and its original are removed (after the server confirmed the file as `clean`, or by the wipe). */
    @Throws(IOException::class)
    fun delete(assetId: String) {
        AtomicFiles.delete(files.jobFile(assetId))
        AtomicFiles.delete(files.originalFile(assetId))
    }

    private fun write(data: JobFileData) = AtomicFiles.write(files.jobFile(data.assetId), JobFileCodec.encode(data))
}
