package pl.eviacharge.upload

import java.io.File
import java.net.URI

/** Locates and reads the shared conformance vectors (`packages/sync-core/conformance/upload`). A missing directory or file fails. */
object Vectors {
    val directory: File by lazy {
        val path = checkNotNull(System.getProperty("evia.vectors.dir")) { "system property evia.vectors.dir is not set" }
        File(path).also { check(it.isDirectory) { "conformance vectors directory is missing: $path" } }
    }

    fun read(name: String): Map<String, Any?> {
        val file = File(directory, name)
        check(file.isFile) { "vector file is missing: $name" }
        return Json.obj(Json.parse(file.readText()))
    }

    /** Files listed in `index.json`. */
    fun indexed(): List<String> = Json.list(read("index.json")["files"]).map { it as String }

    /** `*.json` files in the directory besides `index.json`. */
    fun onDisk(): List<String> =
        directory
            .listFiles()
            .orEmpty()
            .map { it.name }
            .filter { it.endsWith(".json") && it != "index.json" }
            .sorted()
}

class CrashSignal : RuntimeException("crash")

/** Names of the checkpoints in the vectors (`crashAt.checkpoint`). */
val CHECKPOINT_NAMES =
    mapOf(
        Checkpoint.AFTER_SESSION to "afterSession",
        Checkpoint.AFTER_PART_PUT to "afterPartPut",
        Checkpoint.AFTER_PART_SAVED to "afterPartSaved",
        Checkpoint.BEFORE_COMPLETE to "beforeComplete",
        Checkpoint.AFTER_COMPLETE_BEFORE_SAVE to "afterCompleteBeforeSave",
    )

/** Numbers to `Long`, recursively, so the expectations read from JSON compare with what the engine produced. */
fun normalize(value: Any?): Any? =
    when (value) {
        is Number -> value.toLong()
        is Map<*, *> -> value.entries.associate { it.key.toString() to normalize(it.value) }
        is List<*> -> value.map { normalize(it) }
        else -> value
    }

fun outcomeWire(outcome: Outcome): Map<String, Any?> =
    when (outcome) {
        is Outcome.NeedsAttention -> {
            mapOf("type" to outcome.type, "reason" to outcome.reason.code)
        }

        is Outcome.RetryLater -> {
            if (outcome.delayMs ==
                null
            ) {
                mapOf("type" to outcome.type)
            } else {
                mapOf("type" to outcome.type, "delayMs" to outcome.delayMs)
            }
        }

        else -> {
            mapOf("type" to outcome.type)
        }
    }

class FakeSession(
    val id: String,
    val key: String?,
    var state: String,
    val parts: MutableMap<Int, Long>,
)

class Fault(
    val op: String,
    val part: Int?,
    val effect: String,
    var times: Int,
)

/** Deterministic fake of the API and the storage; the same behaviour as in `packages/sync-core/conformance/upload.ts`. */
class FakeServer(
    spec: Map<String, Any?>,
    private val size: Long,
    faultSpecs: List<Map<String, Any?>>,
) : UploadApi,
    PartTransport {
    val calls = mutableListOf<String>()
    val puts = sortedMapOf<Int, Int>()
    var objects = 0
    var sessionsCreated = 0
    private var counter = 0
    private val partSize = (spec["partSize"] as Number).toLong()
    private val fileState = spec["fileState"] as String
    private val host = spec["partUrlHost"] as String
    private val partCountOverride = (spec["partCount"] as? Number)?.toInt()
    private val contentLengthOverride = (spec["partUrlContentLength"] as? Number)?.toLong()
    private val createId = spec["createId"] as? String
    private val putEtag = spec["putEtag"] as? String
    private val omitEtag = spec["omitEtag"] == true
    private val listOverride =
        (spec["listOverride"] as? List<*>)?.map {
            val item = Json.obj(it)
            RemotePart((item["partNumber"] as Number).toInt(), (item["size"] as Number).toLong())
        }
    private val completeResult =
        (spec["completeResult"] as? Map<*, *>)?.let {
            FileState(it["state"] as String, it["reasonCode"] as? String)
        } ?: FileState("uploaded")
    private val sessions =
        Json
            .list(spec["sessions"])
            .map {
                val item = Json.obj(it)
                val parts =
                    Json.list(item["parts"]).associate { part ->
                        val entry = Json.obj(part)
                        (entry["partNumber"] as Number).toInt() to (entry["size"] as Number).toLong()
                    }
                FakeSession(item["id"] as String, item["key"] as? String, item["state"] as String, parts.toMutableMap())
            }.toMutableList()
    private var dropAfterList: Int? = null
    private val faults =
        faultSpecs.map {
            Fault(it["op"] as String, (it["part"] as? Number)?.toInt(), it["effect"] as String, (it["times"] as Number).toInt())
        }

    val open: Int get() = sessions.count { it.state == "active" }

    private fun partCount(): Int = partCountOverride ?: ((size + partSize - 1) / partSize).toInt()

    private fun length(part: Int): Long = minOf(partSize, size - (part - 1) * partSize)

    /** Records the call and applies the next matching fault; returns true when the answer must be dropped after executing. */
    private fun enter(
        op: String,
        part: Int? = null,
    ): Boolean {
        calls.add(if (part == null) op else "$op:$part")
        val fault = faults.firstOrNull { it.op == op && it.times > 0 && (it.part == null || it.part == part) } ?: return false
        fault.times -= 1
        if (fault.effect == "lost_response") return true
        if (fault.effect.startsWith("drop_after_list:")) {
            dropAfterList = fault.effect.split(':')[1].toInt()
            return false
        }
        if (fault.effect == "network") throw UploadFailure(Failure.Network)
        val pieces = fault.effect.split(':')
        throw UploadFailure(Failure.Http(pieces[1].toInt(), pieces.getOrNull(2)))
    }

    private fun conflict(): Nothing = throw UploadFailure(Failure.Http(409, "invalid_state_transition"))

    override fun createSession(
        assetId: String,
        sessionId: String,
        idempotencyKey: String,
    ): SessionInfo {
        val lost = enter("createSession")
        val byKey = sessions.firstOrNull { it.key == idempotencyKey }
        var session = byKey ?: sessions.firstOrNull { it.state == "active" }
        if (byKey != null && byKey.state != "active") conflict()
        if (session == null) {
            if (fileState != "pending_upload") conflict()
            session = FakeSession(sessionId, idempotencyKey, "active", mutableMapOf())
            sessions.add(session)
            sessionsCreated += 1
        }
        if (lost) throw UploadFailure(Failure.Network)
        return SessionInfo(createId ?: session.id, partSize, partCount())
    }

    override fun listParts(sessionId: String): List<RemotePart> {
        val lost = enter("listParts")
        val session = sessions.firstOrNull { it.id == sessionId } ?: throw UploadFailure(Failure.Http(404, "not_found"))
        if (session.state != "active") conflict()
        if (lost) throw UploadFailure(Failure.Network)
        val answer = listOverride ?: session.parts.map { RemotePart(it.key, it.value) }
        // The part vanishes from the storage right after the answer (cleanup of the multipart, rollback).
        dropAfterList?.let { session.parts.remove(it) }
        dropAfterList = null
        return answer
    }

    override fun partUrl(
        sessionId: String,
        partNumber: Int,
    ): PartUrl {
        val lost = enter("partUrl", partNumber)
        if (sessions.firstOrNull { it.id == sessionId }?.state != "active") conflict()
        if (lost) throw UploadFailure(Failure.Network)
        counter += 1
        return PartUrl("https://$host/$sessionId/$partNumber?X-Amz-Signature=sig$counter", contentLengthOverride ?: length(partNumber))
    }

    override fun put(request: PartRequest): String? {
        val pieces = URI(request.url).path.split('/')
        val number = pieces[2].toInt()
        val lost = enter("put", number)
        val session = sessions.firstOrNull { it.id == pieces[1] }
        if (session == null || request.length != length(number)) throw UploadFailure(Failure.Http(400))
        session.parts[number] = request.length
        puts[number] = (puts[number] ?: 0) + 1
        if (lost) throw UploadFailure(Failure.Network)
        return if (omitEtag) null else putEtag ?: "\"etag-$number\""
    }

    override fun complete(sessionId: String): FileState {
        val lost = enter("complete")
        val session = sessions.firstOrNull { it.id == sessionId } ?: throw UploadFailure(Failure.Http(404, "not_found"))
        if (session.state != "completed") {
            if (session.state != "active") conflict()
            val whole = (1..partCount()).all { session.parts[it] == length(it) }
            if (!whole) throw UploadFailure(Failure.Http(422, "parts_missing"))
            session.state = "completed"
            objects += 1
        }
        if (lost) throw UploadFailure(Failure.Network)
        return completeResult
    }
}

class MemoryStore(
    initial: JobSnapshot?,
) : JobStore {
    var snapshot: JobSnapshot? = initial

    override fun load(assetId: String): JobSnapshot? = snapshot

    override fun save(snapshot: JobSnapshot) {
        this.snapshot = snapshot
    }

    override fun clear(assetId: String) {
        snapshot = null
    }
}

/** Runs one scenario of `resume.json`; returns the list of mismatches (empty = the engine agrees with the vector). */
fun runScenario(
    scenario: Map<String, Any?>,
    defaults: Map<String, Any?>,
): List<String> {
    val id = scenario["id"] as String
    val size = ((scenario["size"] ?: defaults["size"]) as Number).toLong()
    val server =
        FakeServer(
            Json.obj(defaults["server"]) + Json.obj(scenario["server"] ?: emptyMap<String, Any?>()),
            size,
            Json.list(scenario["faults"] ?: emptyList<Any?>()).map { Json.obj(it) },
        )
    val initial = (scenario["initialStore"] as? Map<*, *>)?.let { JobSnapshot.fromFields(Json.obj(it)) }
    val store = MemoryStore(initial)
    val ids = Json.list(scenario["ids"] ?: defaults["ids"]).map { it as String }.toMutableList()
    val rngValues = Json.list(scenario["rng"] ?: defaults["rng"]).map { (it as Number).toDouble() }
    val allowedHosts = Json.list(defaults["allowedHosts"]).map { it as String }
    var rngIndex = 0
    var sleeps = mutableListOf<Long>()
    var crashAt: Map<String, Any?>? = null
    var seen = 0
    val assetId = defaults["assetId"] as String

    fun newEngine() =
        UploadEngine(
            UploadEngineDeps(
                api = server,
                transport = server,
                store = store,
                allowedHosts = allowedHosts,
                sleeper = { sleeps.add(it) },
                random = { rngValues[rngIndex++ % rngValues.size] },
                ids = { if (ids.isEmpty()) "exhausted-ids" else ids.removeAt(0) },
                checkpoints = {
                    val target = crashAt
                    if (target != null && CHECKPOINT_NAMES[it] == target["checkpoint"] &&
                        ++seen == (target["nth"] as Number).toInt()
                    ) {
                        throw CrashSignal()
                    }
                },
            ),
        )

    val problems = mutableListOf<String>()
    var engine = newEngine()
    Json.list(scenario["runs"]).forEachIndexed { index, runSpec ->
        val run = Json.obj(runSpec)
        sleeps = mutableListOf()
        seen = 0
        crashAt = run["crashAt"]?.let { Json.obj(it) }
        val before = server.calls.size
        val outcome: Any =
            try {
                outcomeWire(engine.run(assetId, size))
            } catch (crash: CrashSignal) {
                engine = newEngine()
                "crashed"
            }
        val expected = Json.obj(run["expect"])
        val actual = mutableMapOf<String, Any?>("outcome" to outcome, "calls" to server.calls.drop(before), "sleeps" to sleeps.toList())
        if (expected.containsKey("store")) actual["store"] = store.snapshot?.state?.wire
        if (normalize(actual) != normalize(expected)) problems.add("$id run ${index + 1}: $actual != $expected")
    }
    val expectedFinal = Json.obj(scenario["final"])
    val actualFinal =
        mapOf(
            "objects" to server.objects,
            "sessionsCreated" to server.sessionsCreated,
            "open" to server.open,
            "puts" to server.puts.entries.associate { it.key.toString() to it.value },
            "store" to store.snapshot?.state?.wire,
        )
    if (normalize(actualFinal) != normalize(expectedFinal)) problems.add("$id final: $actualFinal != $expectedFinal")
    return problems
}
