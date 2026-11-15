package pl.eviacharge.upload.files

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

private const val BUFFER_BYTES = 64 * 1024

/** SHA-256 of a file, computed as a stream: the file is never read into memory whole (videos of hundreds of MB). */
object FileDigest {
    @Throws(IOException::class)
    fun sha256Hex(file: File): String = file.inputStream().use { sha256Hex(it) }

    @Throws(IOException::class)
    fun sha256Hex(stream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

/** What happens to the local original after the server's answer about the file (EVM-130 AC4: it stays until the server says `clean`). */
enum class OriginalVerdict {
    /** The server confirmed the file as `clean` (or a later state): the local original may go. */
    DELETE,

    /** The file is on the server but not yet checked (`uploaded`, `scanning`) or the state is unknown: the original stays. */
    KEEP,

    /** `failed` with `checksum_mismatch`: the original stays and the upload is offered again ("Ponów"). */
    KEEP_AND_RETRY,

    /** `quarantined`: the original stays, the user has to decide. */
    KEEP_QUARANTINED,
}

/** The pure rule for the local original; the deletion itself is the business of the app, after this verdict. */
object OriginalPolicy {
    private val CONFIRMED = setOf("clean", "processing", "ready")

    fun verdict(
        state: String,
        reasonCode: String? = null,
    ): OriginalVerdict =
        when {
            state in CONFIRMED -> OriginalVerdict.DELETE
            state == "quarantined" -> OriginalVerdict.KEEP_QUARANTINED
            state == "failed" && reasonCode == "checksum_mismatch" -> OriginalVerdict.KEEP_AND_RETRY
            else -> OriginalVerdict.KEEP
        }
}
