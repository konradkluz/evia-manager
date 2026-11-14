package pl.eviacharge.upload.files

import pl.eviacharge.upload.Json
import pl.eviacharge.upload.JsonException
import java.io.File
import java.io.IOException

/** A reading of the clocks of the phone (the glue of Android provides them). `bootId` changes with every start of the phone. */
data class ClockReading(
    val wallMs: Long,
    val monoMs: Long,
    val bootId: String,
)

fun interface ClockReadings {
    fun read(): ClockReading
}

/** What the native side knows about the last contact; the app takes the later of its own and this one (EVM-101 AC2, SR-MOB-05). */
data class ContactMark(
    val wallMs: Long,
    val monoMs: Long,
    val bootId: String,
    /** `Date` of the answer of the server, when there was a valid one. */
    val serverTimeMs: Long?,
)

/** An authenticated contact with the API happened. Only a successful, authenticated answer of the API counts, never the secure store. */
fun interface ContactSink {
    fun contact(serverTimeMs: Long?)

    companion object {
        val NONE = ContactSink { }
    }
}

/**
 * The durable mark of the last successful authenticated contact with the API (architect 9, security 3). The JavaScript of the app does
 * not run while the work goes on in the background, so the native side writes the mark itself; it is not a secret. A write is at most
 * once per [THROTTLE_MS] of the monotonic clock (flash wear); a failed write never fails the work.
 */
class ContactMarker(
    private val file: File,
    private val readings: ClockReadings,
) : ContactSink {
    private var last: ContactMark? = null
    private var loaded = false

    @Synchronized
    override fun contact(serverTimeMs: Long?) {
        val now = readings.read()
        val previous = known()
        if (previous != null && previous.bootId == now.bootId && now.monoMs - previous.monoMs in 0 until THROTTLE_MS) return
        val mark = ContactMark(now.wallMs, now.monoMs, now.bootId, serverTimeMs)
        try {
            AtomicFiles.write(file, encode(mark))
            last = mark
        } catch (error: IOException) {
            // the app then relies on its own mark; the data stay hidden when there is none (fail closed)
        }
    }

    @Synchronized
    fun read(): ContactMark? = known()

    private fun known(): ContactMark? {
        if (!loaded) {
            loaded = true
            last = AtomicFiles.read(file, MAX_BYTES)?.let { decode(it) }
        }
        return last
    }

    private fun encode(mark: ContactMark): ByteArray =
        Json
            .stringify(
                mapOf(
                    "v" to 1,
                    "wallMs" to mark.wallMs,
                    "monoMs" to mark.monoMs,
                    "bootId" to mark.bootId,
                    "serverTimeMs" to mark.serverTimeMs,
                ),
            ).toByteArray(Charsets.UTF_8)

    private fun decode(bytes: ByteArray): ContactMark? {
        val fields =
            try {
                Json.parse(String(bytes, Charsets.UTF_8)) as? Map<*, *>
            } catch (error: JsonException) {
                null
            } ?: return null
        if (fields["v"] != 1L) return null
        return ContactMark(
            wallMs = fields["wallMs"] as? Long ?: return null,
            monoMs = fields["monoMs"] as? Long ?: return null,
            bootId = (fields["bootId"] as? String)?.takeIf { it.isNotEmpty() && it.length <= MAX_BOOT_ID } ?: return null,
            serverTimeMs = fields["serverTimeMs"] as? Long,
        )
    }

    companion object {
        const val THROTTLE_MS = 60_000L
        private const val MAX_BYTES = 4096
        private const val MAX_BOOT_ID = 128
    }
}
