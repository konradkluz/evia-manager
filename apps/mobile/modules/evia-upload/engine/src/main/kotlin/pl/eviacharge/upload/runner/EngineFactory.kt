package pl.eviacharge.upload.runner

import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.IdSource
import pl.eviacharge.upload.JobStore
import pl.eviacharge.upload.RandomSource
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.Sleeper
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadEngine
import pl.eviacharge.upload.UploadEngineDeps
import pl.eviacharge.upload.files.ContactSink
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.http.HttpConfig
import pl.eviacharge.upload.http.HttpCore
import pl.eviacharge.upload.http.HttpPartTransport
import pl.eviacharge.upload.http.HttpUploadApi
import pl.eviacharge.upload.session.ApiSession
import java.security.SecureRandom
import java.util.concurrent.ThreadLocalRandom

/** `Thread.sleep` for the backoff of the engine; an interrupt (the stop of the job) is a cancellation, never a failure of the network. */
object ThreadSleeper : Sleeper {
    override fun sleep(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw UploadCancelledException()
        }
    }
}

object ThreadRandom : RandomSource {
    override fun nextDouble(): Double = ThreadLocalRandom.current().nextDouble()
}

/** UUIDv7 (RFC 9562): 48 bits of the time in milliseconds, the version, the variant and 74 random bits. Identifiers of the session and of the key. */
class UuidV7Source(
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val random: SecureRandom = SecureRandom(),
) : IdSource {
    override fun newId(): String {
        val bytes = ByteArray(UUID_BYTES)
        random.nextBytes(bytes)
        val time = nowMs()
        for (index in 0 until TIME_BYTES) bytes[index] = (time ushr (BITS_PER_BYTE * (TIME_BYTES - 1 - index))).toByte()
        bytes[VERSION_BYTE] = ((bytes[VERSION_BYTE].toInt() and LOW_NIBBLE) or VERSION_7).toByte()
        bytes[VARIANT_BYTE] = ((bytes[VARIANT_BYTE].toInt() and VARIANT_MASK) or VARIANT_RFC).toByte()
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }

    private companion object {
        const val UUID_BYTES = 16
        const val TIME_BYTES = 6
        const val BITS_PER_BYTE = 8
        const val VERSION_BYTE = 6
        const val VARIANT_BYTE = 8
        const val LOW_NIBBLE = 0x0f
        const val VERSION_7 = 0x70
        const val VARIANT_MASK = 0x3f
        const val VARIANT_RFC = 0x80
    }
}

/**
 * Builds the engine of one job with every adapter (EVM-130): the HTTP policy of the build, the API of the owner's session, the part
 * transport reading the original from its file, the store that reports the throttled progress. One [HttpCore] per job (one thread).
 * The cancel handle is the one [RunningJobs.begin] made for the job, so that a stop before this point still takes effect.
 */
class EngineFactory(
    private val config: HttpConfig,
    private val session: ApiSession,
    private val files: UploadFiles,
    private val store: JobStore,
    private val stop: StopCheck,
    private val contact: ContactSink,
    private val running: RunningJobs,
    private val ids: IdSource = UuidV7Source(),
    private val sleeper: Sleeper = ThreadSleeper,
    private val random: RandomSource = ThreadRandom,
    private val logger: RedactingLogger = RedactingLogger.NONE,
) {
    fun create(job: JobFileData): UploadEngine {
        val cancel = running.handle(job.assetId) ?: CancelHandle()
        val core = HttpCore(config, cancel, stop)
        return UploadEngine(
            UploadEngineDeps(
                api = HttpUploadApi(core, session, contact, job.workOrderId, job.assetId),
                transport = HttpPartTransport(core, cancel, stop, files.originalFile(job.assetId)),
                store = store,
                allowedHosts = config.storageHosts,
                sleeper = sleeper,
                random = random,
                ids = ids,
                logger = logger,
                stop = stop,
                allowCleartextPartUrls = config.e2eCleartext,
            ),
        )
    }
}
