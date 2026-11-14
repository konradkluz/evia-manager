package pl.eviacharge.upload.files

import pl.eviacharge.upload.Json
import pl.eviacharge.upload.JsonException
import java.io.File
import java.io.IOException

/** The reserved range of system job ids is full: more jobs than the module may ever have at once. */
class JobIdRangeExhaustedException : IllegalStateException("job id range exhausted")

/**
 * The durable mapping asset → id of the system job (`JobScheduler`), the same id after every restart of the app, so that arming a job
 * twice replaces it instead of duplicating it. The ids come from a reserved range (so they do not collide with jobs of other libraries
 * of the app) and from a counter, never from a hash (two assets must never share an id). Thread safe.
 */
class JobIdRegistry(
    private val file: File,
    private val base: Int = DEFAULT_BASE,
    private val range: Int = DEFAULT_RANGE,
) {
    private var loaded = false
    private var next = 0
    private val ids = linkedMapOf<String, Int>()

    /** The id of the asset: the existing one or a new one. @throws IOException when the mapping cannot be stored (nothing is allocated). */
    @Synchronized
    @Throws(IOException::class)
    fun idFor(assetId: String): Int {
        load()
        ids[assetId]?.let { return it }
        if (ids.size >= range) throw JobIdRangeExhaustedException()
        var candidate = next
        while (ids.containsValue(base + candidate)) candidate = (candidate + 1) % range
        val previousNext = next
        next = (candidate + 1) % range
        ids[assetId] = base + candidate
        try {
            store()
        } catch (error: IOException) {
            ids.remove(assetId)
            next = previousNext
            throw error
        }
        return base + candidate
    }

    /** The asset was done: its id can be used again (later in the circle). A missing asset is nothing to do. */
    @Synchronized
    @Throws(IOException::class)
    fun release(assetId: String) {
        load()
        val old = ids.remove(assetId) ?: return
        try {
            store()
        } catch (error: IOException) {
            ids[assetId] = old
            throw error
        }
    }

    /** The wipe: the mapping is gone from memory and from the disk. */
    @Synchronized
    @Throws(IOException::class)
    fun forget() {
        ids.clear()
        next = 0
        loaded = true
        AtomicFiles.delete(file)
    }

    /** Every id handed out (what the wipe cancels in the system). */
    @Synchronized
    fun allIds(): List<Int> {
        load()
        return ids.values.toList()
    }

    @Synchronized
    fun contains(id: Int): Boolean {
        load()
        return ids.containsValue(id)
    }

    private fun load() {
        if (loaded) return
        loaded = true
        // an unreadable mapping starts empty: the jobs are armed again from the queue and get an id again
        val (storedNext, stored) = parse() ?: return
        ids.putAll(stored)
        next = storedNext
    }

    private fun parse(): Pair<Int, Map<String, Int>>? {
        val bytes = AtomicFiles.read(file, MAX_BYTES) ?: return null
        val fields =
            try {
                Json.parse(String(bytes, Charsets.UTF_8)) as? Map<*, *>
            } catch (error: JsonException) {
                null
            } ?: return null
        val storedNext = (fields["next"] as? Number)?.toInt()?.takeIf { it in 0 until range } ?: return null
        val stored = fields["ids"] as? Map<*, *> ?: return null
        val parsed = linkedMapOf<String, Int>()
        for ((key, value) in stored) {
            val asset = (key as? String)?.takeIf { UploadFiles.isAssetId(it) } ?: return null
            parsed[asset] = (value as? Number)?.toInt()?.takeIf { it in base until base + range } ?: return null
        }
        return storedNext to parsed
    }

    private fun store() = AtomicFiles.write(file, Json.stringify(mapOf("next" to next, "ids" to ids)).toByteArray(Charsets.UTF_8))

    companion object {
        /** Reserved range: 0x45560000 ("EV") and the next 10 000 ids. */
        const val DEFAULT_BASE = 0x45560000
        const val DEFAULT_RANGE = 10_000
        private const val MAX_BYTES = 1024 * 1024
    }
}
