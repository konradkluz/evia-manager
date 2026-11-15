package pl.eviacharge.upload.schedule

import pl.eviacharge.upload.files.AtomicFiles
import pl.eviacharge.upload.files.FileDigest
import pl.eviacharge.upload.files.JobIdRegistry
import pl.eviacharge.upload.files.OriginalPolicy
import pl.eviacharge.upload.files.OriginalVerdict
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.runner.RunningJobs
import java.io.File
import java.io.IOException

/** Size and SHA-256 of an original, computed natively as a stream: the bytes of a photo or a video never pass through JavaScript. */
class OriginalDigest(
    val sizeBytes: Long,
    val sha256Hex: String,
)

/**
 * The files of an upload outside the run itself (EVM-130 AC4): the digest of the original before `CreateMediaAsset`, the end of a
 * job after the server's answer (the original goes only when the server confirmed the file, [OriginalPolicy]) and the cancellation by
 * the user. Every path comes from [UploadFiles] (a UUID checked against a regular expression), never from the caller.
 */
class JobLifecycle(
    private val files: UploadFiles,
    private val ids: JobIdRegistry,
    private val system: SystemJobs,
    private val running: RunningJobs,
) {
    /** The private place for the original of [assetId] (its directory is created); where the camera or the hook writes it. */
    @Throws(IOException::class)
    fun originalFile(assetId: String): File {
        val file = files.originalFile(assetId)
        file.parentFile?.mkdirs()
        return file
    }

    /** `null` when there is no original (or it is empty). */
    fun digest(assetId: String): OriginalDigest? {
        val file = files.originalFile(assetId)
        if (!file.isFile || file.length() == 0L) return null
        return try {
            OriginalDigest(file.length(), FileDigest.sha256Hex(file))
        } catch (error: IOException) {
            null
        }
    }

    /**
     * The server told the state of the file in its replica: the original and the job go only for a confirmed file (`clean` and later);
     * `uploaded` and `scanning` keep them, `checksum_mismatch` and `quarantined` keep them with their own verdict (a retry, a decision).
     */
    fun complete(
        assetId: String,
        serverState: String,
        reasonCode: String?,
    ): OriginalVerdict {
        val verdict = OriginalPolicy.verdict(serverState, reasonCode)
        if (verdict == OriginalVerdict.DELETE) discard(assetId, deleteOriginal = true)
        return verdict
    }

    /** The user cancels the file: the job stops and goes; the original goes only when [deleteOriginal] is set. */
    fun cancel(
        assetId: String,
        deleteOriginal: Boolean,
    ): Boolean = discard(assetId, deleteOriginal)

    /** `false` when something could not be removed (the next call tries again). */
    private fun discard(
        assetId: String,
        deleteOriginal: Boolean,
    ): Boolean {
        val id = ids.existing(assetId)
        running.stop(assetId)
        if (id != null) system.cancel(id)
        return try {
            AtomicFiles.delete(files.jobFile(assetId))
            if (deleteOriginal) AtomicFiles.delete(files.originalFile(assetId))
            if (id != null) ids.release(assetId)
            true
        } catch (error: IOException) {
            false
        }
    }
}

/** Synthetic files of the e2e variant (no camera): deterministic bytes of the requested size, written as a stream. */
object SyntheticFile {
    const val MAX_BYTES = 256L * 1024 * 1024
    private const val CHUNK = 64 * 1024
    private const val PRIME = 31L

    /** `false` when the size is out of range. The content depends on [seed] only (a counter pattern), so a run can be compared with another. */
    @Throws(IOException::class)
    fun write(
        target: File,
        sizeBytes: Long,
        seed: Int,
    ): Boolean {
        if (sizeBytes !in 1..MAX_BYTES) return false
        target.parentFile?.mkdirs()
        val chunk = ByteArray(CHUNK)
        target.outputStream().use { out ->
            var written = 0L
            while (written < sizeBytes) {
                val length = minOf(CHUNK.toLong(), sizeBytes - written).toInt()
                for (index in 0 until length) chunk[index] = ((written + index) * PRIME + seed).toByte()
                out.write(chunk, 0, length)
                written += length
            }
            out.flush()
        }
        return true
    }
}
