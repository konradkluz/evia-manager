package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private const val ASSET = "asset-1"
private const val SIZE = 40L

private val SERVER_SPEC: Map<String, Any?> =
    mapOf(
        "partSize" to 16L,
        "fileState" to "pending_upload",
        "partUrlHost" to "store.example.test",
        "sessions" to emptyList<Any?>(),
    )

private class Harness(
    spec: Map<String, Any?> = SERVER_SPEC,
    initial: JobSnapshot? = null,
    faults: List<Map<String, Any?>> = emptyList(),
) {
    val server = FakeServer(spec, SIZE, faults)
    val store = MemoryStore(initial)
    val saved = mutableListOf<JobSnapshot>()
    val requests = mutableListOf<PartRequest>()
    val logs = mutableListOf<String>()
    private var counter = 0

    private val recordingStore =
        object : JobStore {
            override fun load(assetId: String) = store.load(assetId)

            override fun save(snapshot: JobSnapshot) {
                saved.add(snapshot)
                store.save(snapshot)
            }

            override fun clear(assetId: String) = store.clear(assetId)
        }

    private val recordingTransport =
        PartTransport {
            requests.add(it)
            server.put(it)
        }

    fun engine(network: NetworkGate = NetworkGate.OPEN): UploadEngine =
        UploadEngine(
            UploadEngineDeps(
                api = server,
                transport = recordingTransport,
                store = recordingStore,
                allowedHosts = listOf("store.example.test"),
                sleeper = { },
                random = { 0.0 },
                ids = { "id-${++counter}" },
                logger = RedactingLogger { logs.add(it) },
                network = network,
            ),
        )
}

private fun snapshot(
    state: JobState = JobState.ACTIVE,
    partCount: Int? = 3,
    version: Int = SNAPSHOT_SCHEMA_VERSION,
) = JobSnapshot(
    version,
    ASSET,
    SIZE,
    "id-1",
    "id-2",
    16L,
    partCount,
    false,
    state,
    emptyMap(),
)

class EngineBehaviorTest {
    @Test
    fun `EVM-110 AC5 a network with charges stops a video between parts without an error and the next run continues without a`() {
        val harness = Harness()
        var asked = 0
        // the first part goes over Wi-Fi, then the phone is left with a network with charges
        val outcome = harness.engine { ++asked <= 1 }.run(ASSET, declare(SIZE))
        assertEquals(Outcome.WaitingForWifi, outcome)
        assertEquals(1, harness.requests.size)
        assertEquals(mapOf("1" to "\"etag-1\""), harness.saved.last().etags)
        // Wi-Fi is back: the same session continues with the missing parts only (the first one is not sent again)
        assertEquals(Outcome.Uploaded, harness.engine().run(ASSET, declare(SIZE)))
        assertEquals(listOf(1, 2, 3), harness.requests.map { (it.offset / 16 + 1).toInt() })
    }

    @Test
    fun `EVM-110 AC5 a film abandoned after 7 days goes on as the same asset in a new session without a duplicate`() {
        // the server aborted the session of a film that waited for Wi-Fi (the file is `failed` / `abandoned` until it is sent again)
        val spec =
            SERVER_SPEC +
                mapOf(
                    "sessions" to
                        listOf(
                            mapOf(
                                "id" to "sess-old",
                                "key" to "key-old",
                                "state" to "aborted",
                                "parts" to listOf(mapOf("partNumber" to 1L, "size" to 16L)),
                            ),
                        ),
                )
        val stored =
            JobSnapshot(
                SNAPSHOT_SCHEMA_VERSION,
                ASSET,
                SIZE,
                "sess-old",
                "key-old",
                16L,
                3,
                false,
                JobState.ACTIVE,
                mapOf("1" to "\"etag-1\""),
            )
        val harness = Harness(spec, stored)
        assertEquals(Outcome.Uploaded, harness.engine().run(ASSET, declare(SIZE)))
        // one NEW session for the same asset, the parts of the abandoned one are not counted: all three parts go once
        assertEquals(1, harness.server.sessionsCreated)
        assertEquals(
            listOf(1, 2, 3),
            harness.server.puts.keys
                .toList(),
        )
        assertTrue(
            harness.server.puts.values
                .all { it == 1 },
        )
        assertEquals(1, harness.server.objects)
        assertEquals(listOf(0L, 16L, 32L), harness.requests.map { it.offset })
        // the declaration is the same file (same digest and size) as before
        assertEquals(
            1,
            harness.server.declarations
                .map { it.sha256 }
                .toSet()
                .size,
        )
        assertEquals(ASSET, harness.saved.last().assetId)
        assertFalse(harness.saved.last().uploadSessionId == "sess-old")
    }

    @Test
    fun `EVM-110 AC4 a video held for Wi-Fi sends no part at all and is not a failure`() {
        val harness = Harness()
        assertEquals(Outcome.WaitingForWifi, harness.engine { false }.run(ASSET, declare(SIZE)))
        assertTrue(harness.requests.isEmpty())
        assertEquals("waiting_wifi", Outcome.WaitingForWifi.type)
    }

    @Test
    fun `EVM-109 AC3 a part request carries only Content-Length and never Authorization`() {
        val harness = Harness()
        assertEquals(Outcome.Uploaded, harness.engine().run(ASSET, declare(SIZE)))
        assertEquals(3, harness.requests.size)
        harness.requests.forEach {
            assertEquals(setOf("Content-Length"), it.headers.keys)
            assertEquals(it.length.toString(), it.headers["Content-Length"])
        }
        assertEquals(listOf(0L to 16L, 16L to 16L, 32L to 8L), harness.requests.map { it.offset to it.length })
    }

    @Test
    fun `EVM-109 AC3 the persisted snapshot holds only allowlisted keys and no address, token or name`() {
        val harness = Harness()
        harness.engine().run(ASSET, declare(SIZE))
        assertTrue(harness.saved.isNotEmpty())
        harness.saved.forEach { saved ->
            val fields = saved.toFields()
            assertEquals(JobSnapshot.FIELD_NAMES, fields.keys)
            val text = fields.toString()
            assertFalse(Regex("(?i)https?:|x-amz|bearer|signature|store\\.example").containsMatchIn(text), text)
        }
        assertEquals(mapOf("1" to "\"etag-1\"", "2" to "\"etag-2\"", "3" to "\"etag-3\""), harness.saved.last().etags)
    }

    @Test
    fun `EVM-109 AC3 the engine logs through the redacting logger and never writes an address or a signature`() {
        val harness = Harness(faults = listOf(mapOf("op" to "put", "part" to 1L, "effect" to "http:403", "times" to 1L)))
        harness.engine().run(ASSET, declare(SIZE))
        assertTrue(harness.logs.isNotEmpty())
        harness.logs.forEach { assertFalse(Regex("(?i)https?:|x-amz|sig[0-9]|store\\.example").containsMatchIn(it), it) }
        assertTrue(harness.logs.any { it.startsWith("url_renewed") })
        assertTrue(harness.logs.any { it.startsWith("run_finished outcome=uploaded") })
    }

    @Test
    fun `EVM-109 AC3 the address and the request never print their address in toString`() {
        val request = PartRequest("https://store.example.test/x?X-Amz-Signature=abc", 0, 16, mapOf("Content-Length" to "16"))
        val url = PartUrl("https://store.example.test/x?X-Amz-Signature=abc", 16)
        assertFalse(request.toString().contains("store"))
        assertFalse(url.toString().contains("Signature"))
    }

    @Test
    fun `EVM-109 AC1 a persisted plan that is inconsistent ends in needs_attention instead of sending`() {
        val harness = Harness(initial = snapshot(partCount = 9))
        assertEquals(Outcome.NeedsAttention(AttentionReason.PLAN_MISMATCH), harness.engine().run(ASSET, declare(SIZE)))
        assertTrue(harness.requests.isEmpty())
    }

    @Test
    fun `EVM-109 AC1 a persisted snapshot without a plan reads the plan as a mismatch`() {
        val harness = Harness(initial = snapshot().copy(partSize = 16L, completeSent = false, partCount = null))
        assertEquals(Outcome.NeedsAttention(AttentionReason.PLAN_MISMATCH), harness.engine().run(ASSET, declare(SIZE)))
    }

    @Test
    fun `EVM-109 AC1 EVM-130 AC5 a paused_revoked snapshot is resumed by the explicit resume and nothing is removed`() {
        val harness =
            Harness(
                spec =
                    SERVER_SPEC +
                        ("sessions" to listOf(mapOf("id" to "id-1", "key" to "id-2", "state" to "active", "parts" to emptyList<Any?>()))),
                initial = snapshot(state = JobState.PAUSED_REVOKED),
            )
        assertEquals(Outcome.Uploaded, harness.engine().run(ASSET, declare(SIZE), resume = true))
        assertTrue(harness.saved.none { it.state == JobState.PAUSED_REVOKED })
    }

    @Test
    fun `EVM-130 AC5 a paused_revoked snapshot without the explicit resume is refused, nothing is sent and the snapshot stays`() {
        val harness = Harness(initial = snapshot(state = JobState.PAUSED_REVOKED))
        assertEquals(Outcome.PausedRevoked, harness.engine().run(ASSET, declare(SIZE)))
        assertEquals(Outcome.PausedRevoked, harness.engine().run(ASSET, declare(SIZE), resume = false))
        assertTrue(harness.server.calls.isEmpty())
        assertTrue(harness.saved.isEmpty())
        assertEquals(JobState.PAUSED_REVOKED, harness.store.snapshot?.state)
    }

    @Test
    fun `EVM-109 AC2 paused_revoked keeps the snapshot and the engine has no way to delete anything`() {
        val faults = listOf(mapOf("op" to "listParts", "effect" to "http:401:session_revoked", "times" to 1L))
        val harness = Harness(faults = faults)
        assertEquals(Outcome.PausedRevoked, harness.engine().run(ASSET, declare(SIZE)))
        assertEquals(JobState.PAUSED_REVOKED, harness.store.snapshot?.state)
        assertTrue(UploadEngine::class.java.declaredMethods.none { it.name.contains("delete", ignoreCase = true) })
    }

    @Test
    fun `EVM-130 AC2 a cancel of the work passes through the engine untouched and the saved progress stays`() {
        val harness = Harness()
        val engine =
            UploadEngine(
                UploadEngineDeps(
                    api = harness.server,
                    transport = { throw UploadCancelledException() },
                    store = harness.store,
                    allowedHosts = listOf("store.example.test"),
                    sleeper = { },
                    random = { 0.0 },
                    ids = { "id-1" },
                ),
            )
        assertThrows(UploadCancelledException::class.java) { engine.run(ASSET, declare(SIZE)) }
        assertEquals(JobState.ACTIVE, harness.store.snapshot?.state)
        assertNotNull(harness.store.snapshot?.partCount)
    }

    @Test
    fun `EVM-130 AC5 a stop signal means device_wipe before the first call and between calls, and the instance stays stopped`() {
        val harness = Harness()
        var stopped = true
        val engine =
            UploadEngine(
                UploadEngineDeps(
                    harness.server,
                    harness.server,
                    harness.store,
                    listOf("store.example.test"),
                    { },
                    { 0.0 },
                    { "id-1" },
                    stop = { stopped },
                ),
            )
        assertEquals(Outcome.DeviceWipe, engine.run(ASSET, declare(SIZE)))
        stopped = false
        assertEquals(Outcome.DeviceWipe, engine.run(ASSET, declare(SIZE)))
        assertTrue(harness.server.calls.isEmpty())
    }

    @Test
    fun `EVM-109 AC2 device_wipe stops the engine for good, zero further calls`() {
        val faults = listOf(mapOf("op" to "createSession", "effect" to "http:401:device_wipe_required", "times" to 1L))
        val harness = Harness(faults = faults)
        val engine = harness.engine()
        assertEquals(Outcome.DeviceWipe, engine.run(ASSET, declare(SIZE)))
        val calls = harness.server.calls.size
        assertEquals(Outcome.DeviceWipe, engine.run(ASSET, declare(SIZE)))
        assertEquals(calls, harness.server.calls.size)
    }

    @Test
    fun `EVM-109 AC2 a 401 with an unknown code is the generic needs_attention`() {
        val faults = listOf(mapOf("op" to "createSession", "effect" to "http:401:unauthenticated", "times" to 1L))
        assertEquals(Outcome.NeedsAttention(AttentionReason.UNKNOWN), Harness(faults = faults).engine().run(ASSET, declare(SIZE)))
    }

    @Test
    fun `EVM-109 AC1 a process killed inside a step is never swallowed by the engine`() {
        val harness = Harness()
        val engine =
            UploadEngine(
                UploadEngineDeps(
                    api = harness.server,
                    transport = { throw CrashSignal() },
                    store = harness.store,
                    allowedHosts = listOf("store.example.test"),
                    sleeper = { },
                    random = { 0.0 },
                    ids = { "id" },
                ),
            )
        assertThrows(CrashSignal::class.java) { engine.run(ASSET, declare(SIZE)) }
    }

    @Test
    fun `EVM-109 AC1 an uploaded snapshot sends nothing`() {
        val harness = Harness(initial = snapshot(state = JobState.UPLOADED))
        assertEquals(Outcome.Uploaded, harness.engine().run(ASSET, declare(SIZE)))
        assertTrue(harness.server.calls.isEmpty())
    }

    @Test
    fun `EVM-109 AC1 an etag from storage is kept only as information`() {
        val harness = Harness(spec = SERVER_SPEC + ("putEtag" to null))
        harness.engine().run(ASSET, declare(SIZE))
        assertNotNull(harness.store.snapshot)
    }

    @Test
    fun `EVM-109 AC2 UploadFailure messages never carry data from the answer`() {
        assertEquals("network", UploadFailure(Failure.Network).message)
        assertEquals("http 503", UploadFailure(Failure.Http(503, "media_storage_unavailable")).message)
    }
}

class SnapshotTest {
    private val complete: Map<String, Any?> = snapshot().toFields()

    @Test
    fun `EVM-109 AC3 the serialized form of a snapshot round trips and holds only the allowlisted keys`() {
        assertEquals(JobSnapshot.FIELD_NAMES, complete.keys)
        assertEquals(snapshot(), JobSnapshot.fromFields(complete))
    }

    @Test
    fun `EVM-109 AC1 an unknown schema version is read, not rejected, so the engine can restart the job`() {
        val read = JobSnapshot.fromFields(snapshot(version = 99).toFields())
        assertEquals(99, read?.schemaVersion)
    }

    @Test
    fun `EVM-109 AC1 a stored form with a missing or malformed field is not recognised`() {
        for (key in listOf("schemaVersion", "assetId", "size", "uploadSessionId", "idempotencyKey", "completeSent", "state", "etags")) {
            assertNull(JobSnapshot.fromFields(complete - key), "without $key")
        }
        assertNull(JobSnapshot.fromFields(complete + ("state" to "teleported")))
        assertNull(JobSnapshot.fromFields(complete + ("size" to "forty")))
        assertNull(JobState.fromWire(null))
    }

    @Test
    fun `EVM-109 AC1 optional plan fields may be absent`() {
        val read = JobSnapshot.fromFields(complete + mapOf("partSize" to null, "partCount" to null))
        assertNull(read?.partSize)
        assertNull(read?.partCount)
    }
}
