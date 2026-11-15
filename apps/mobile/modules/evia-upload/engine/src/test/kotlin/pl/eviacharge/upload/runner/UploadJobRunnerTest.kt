package pl.eviacharge.upload.runner

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.AttentionReason
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.FakeServer
import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.Json
import pl.eviacharge.upload.OriginalMissingException
import pl.eviacharge.upload.PartTransport
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.TEST_SHA
import pl.eviacharge.upload.TEST_TYPE
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadEngine
import pl.eviacharge.upload.UploadEngineDeps
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.files.JobFileGoneException
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.http.HttpAuthApi
import pl.eviacharge.upload.http.HttpConfig
import pl.eviacharge.upload.http.HttpCore
import pl.eviacharge.upload.http.HttpPartTransport
import pl.eviacharge.upload.http.HttpUploadApi
import pl.eviacharge.upload.http.Reply
import pl.eviacharge.upload.http.Seen
import pl.eviacharge.upload.http.TestServer
import pl.eviacharge.upload.session.LogoutAnswer
import pl.eviacharge.upload.session.MemoryVault
import pl.eviacharge.upload.session.RefreshAnswer
import pl.eviacharge.upload.session.TokenOwner
import java.io.File

private const val ASSET = "0193a000-0000-7000-8000-00000000000a"
private const val WORK_ORDER = "0193a000-0000-7000-8000-0000000000d1"
private const val OWNER = "user-1:device-1"

private val SERVER_SPEC: Map<String, Any?> =
    mapOf(
        "partSize" to 16L,
        "fileState" to "pending_upload",
        "partUrlHost" to "store.example.test",
        // the session of the snapshots below, active on the server
        "sessions" to listOf(mapOf("id" to "sess-1", "key" to "key-1", "state" to "active", "parts" to emptyList<Any?>())),
    )

private fun snapshot(state: JobState = JobState.ACTIVE) = JobSnapshot(1, ASSET, 40L, "sess-1", "key-1", 16L, 3, false, state, emptyMap())

/** EVM-130 AC1, AC2, AC5 (SR-MOB-13): one run of one job - the owner, the marker, the engine and what the scheduler is told. */
class UploadJobRunnerTest {
    @TempDir
    lateinit var root: File

    private val files get() = UploadFiles(root)
    private val jobs get() = JobFileStore(files)
    private val marker get() = WipeMarker(files.wipeMarkerFile)
    private val vault = MemoryVault()
    private var clock = 1_000_000L
    private val owner = TokenOwner(vault, { RefreshAnswer.NoAnswer }, { clock }, { LogoutAnswer.UNAVAILABLE })
    private var engineBuilt = 0
    private var transportOverride: PartTransport? = null
    private lateinit var server: FakeServer

    private fun arm(
        snapshot: JobSnapshot? = null,
        userId: String = "user-1",
    ) {
        jobs.arm(JobFileData(ASSET, WORK_ORDER, 40L, userId, "device-1", TEST_TYPE, TEST_SHA, snapshot))
        if (snapshot != null) jobs.save(snapshot)
    }

    private fun faults(vararg effect: Pair<String, String>) = effect.map { mapOf("op" to it.first, "effect" to it.second, "times" to 1L) }

    private fun runner(faults: List<Map<String, Any?>> = emptyList()): UploadJobRunner {
        server = FakeServer(SERVER_SPEC, 40L, faults)
        var counter = 0
        return UploadJobRunner(
            jobs,
            owner,
            marker,
            { job ->
                engineBuilt += 1
                UploadEngine(
                    UploadEngineDeps(
                        api = server,
                        transport = transportOverride ?: server,
                        store = jobs,
                        allowedHosts = listOf("store.example.test"),
                        sleeper = { },
                        random = { 0.5 },
                        ids = { "id-${counter++}" },
                        stop = marker,
                    ),
                ).also { assertEquals(ASSET, job.assetId) }
            },
            RedactingLogger.NONE,
        )
    }

    private fun signIn(who: String = OWNER) = owner.commitLogin(who, "refresh-0", "access-0", 900_000L)

    @Test
    fun `EVM-130 AC1 a job of the signed-in owner is sent, and its file records the end`() {
        arm()
        signIn()
        assertEquals(JobResult.Finished, runner().run(ASSET))
        assertEquals(1, server.objects)
        assertEquals(JobState.UPLOADED, jobs.read(ASSET)?.snapshot?.state)
    }

    @Test
    fun `EVM-130 AC5 a set wipe marker sends nothing and does not even build the engine`() {
        arm()
        signIn()
        marker.begin()
        assertEquals(JobResult.DeviceWipe, runner().run(ASSET))
        assertEquals(0, engineBuilt)
    }

    @Test
    fun `EVM-130 AC5 a job that is gone ends as dropped`() {
        signIn()
        assertEquals(JobResult.Dropped, runner().run(ASSET))
        assertEquals(0, engineBuilt)
    }

    @Test
    fun `EVM-130 AC2 a job of another owner is refused with zero requests, also when the other owner is the one signed in`() {
        arm(userId = "user-2")
        signIn()
        assertEquals(JobResult.WrongOwner, runner().run(ASSET))
        assertEquals(0, engineBuilt)
        assertTrue(server.calls.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 without a session nothing is sent and an active job is parked as paused until a full sign-in`() {
        arm(snapshot())
        assertEquals(JobResult.PausedForSignIn, runner().run(ASSET))
        assertEquals(JobState.PAUSED_REVOKED, jobs.read(ASSET)?.snapshot?.state)
        assertTrue(server.calls.isEmpty())
        // a second run does not change a thing, and a job without a snapshot yet is left as it is
        assertEquals(JobResult.PausedForSignIn, runner().run(ASSET))
        arm()
        jobs.clear(ASSET)
        assertEquals(JobResult.PausedForSignIn, runner().run(ASSET))
        assertNull(jobs.read(ASSET)?.snapshot)
        assertEquals(0, engineBuilt)
    }

    @Test
    fun `EVM-130 AC2 a paused job works again only after a full sign-in of the SAME owner, never for another one`() {
        arm(snapshot(JobState.PAUSED_REVOKED))
        signIn("user-2:device-1")
        assertEquals(JobResult.WrongOwner, runner().run(ASSET))
        assertEquals(JobState.PAUSED_REVOKED, jobs.read(ASSET)?.snapshot?.state)
        assertTrue(server.calls.isEmpty())
        signIn()
        assertEquals(JobResult.Finished, runner().run(ASSET))
        assertEquals(JobState.UPLOADED, jobs.read(ASSET)?.snapshot?.state)
    }

    @Test
    fun `EVM-130 AC2 a revoked session stops the job at the point it reached and the job file keeps the progress`() {
        arm()
        signIn()
        assertEquals(JobResult.PausedForSignIn, runner(faults("partUrl" to "http:401:session_revoked")).run(ASSET))
        val saved = jobs.read(ASSET)?.snapshot
        assertEquals(JobState.PAUSED_REVOKED, saved?.state)
        assertEquals(3, saved?.partCount)
    }

    @Test
    fun `EVM-130 AC5 a wipe demanded by the server and an update demanded by the server stop the job`() {
        arm()
        signIn()
        assertEquals(JobResult.DeviceWipe, runner(faults("createSession" to "http:401:device_wipe_required")).run(ASSET))
        owner.onApiWipeRequired()
        assertEquals(JobResult.DeviceWipe, runner().run(ASSET))
        signIn()
        owner.onApiUpdateRequired()
        assertEquals(JobResult.PausedForUpdate, runner().run(ASSET))
        signIn()
        assertEquals(JobResult.PausedForUpdate, runner(faults("createSession" to "http:426")).run(ASSET))
    }

    @Test
    fun `EVM-130 AC2 what the engine reports becomes what the scheduler is told`() {
        arm()
        signIn()
        assertEquals(
            JobResult.Retry(4000L),
            runner(
                faults(
                    "createSession" to "network",
                    "createSession" to "network",
                    "createSession" to "network",
                    "createSession" to "network",
                ),
            ).run(ASSET),
        )
        assertEquals(
            JobResult.NeedsAttention(AttentionReason.ID_CONFLICT),
            runner(faults("createSession" to "http:409:id_conflict")).run(ASSET),
        )
        assertEquals(JobResult.PausedForUpdate, runner(faults("listParts" to "http:426")).run(ASSET))
    }

    @Test
    fun `EVM-130 AC4 a checksum mismatch clears the snapshot of the job, keeps the original and is its own result`() {
        arm()
        signIn()
        val spec = SERVER_SPEC + ("completeResult" to mapOf("state" to "failed", "reasonCode" to "checksum_mismatch"))
        server = FakeServer(spec, 40L, emptyList())
        val result =
            UploadJobRunner(
                jobs,
                owner,
                marker,
                { UploadEngine(UploadEngineDeps(server, server, jobs, listOf("store.example.test"), { }, { 0.5 }, { "id-x" })) },
            ).run(ASSET)
        assertEquals(JobResult.RetryChecksum, result)
        assertNull(jobs.read(ASSET)?.snapshot)
    }

    @Test
    fun `EVM-130 AC1 a stop of the system is a stopped job, a stop by the wipe marker is a wipe`() {
        arm()
        signIn()
        transportOverride = PartTransport { throw UploadCancelledException() }
        assertEquals(JobResult.Stopped, runner().run(ASSET))
        transportOverride =
            PartTransport {
                marker.begin()
                throw UploadCancelledException()
            }
        assertEquals(JobResult.DeviceWipe, runner().run(ASSET))
    }

    @Test
    fun `EVM-130 AC5 a job file or an original that vanishes in the middle of the work ends the job quietly`() {
        arm()
        signIn()
        transportOverride = PartTransport { throw OriginalMissingException() }
        assertEquals(JobResult.Dropped, runner().run(ASSET))
        transportOverride = PartTransport { throw JobFileGoneException() }
        assertEquals(JobResult.Dropped, runner().run(ASSET))
        transportOverride =
            PartTransport {
                files.jobFile(ASSET).delete()
                "\"etag\""
            }
        assertEquals(JobResult.Dropped, runner().run(ASSET))
    }
}

/** The whole way through real HTTP: runner, owner, adapters, a part from a real file, against a server of the JDK. */
class UploadJobOverHttpTest {
    @TempDir
    lateinit var root: File

    private var server: TestServer? = null

    @AfterEach
    fun tearDown() {
        server?.close()
    }

    private class Storage {
        val parts = sortedMapOf<Int, ByteArray>()
        val puts = mutableMapOf<Int, Int>()
        var completed = false
        var failPartUrlOnce = true
    }

    private fun serve(
        storage: Storage,
        auth: (Seen) -> Reply?,
    ) = TestServer { seen ->
        auth(seen)
            ?: when {
                seen.path.endsWith("/upload-sessions") -> {
                    Reply(201, """{"id":"sess-1","partSize":16,"partCount":3}""")
                }

                seen.path.endsWith("/parts") -> {
                    Reply(
                        200,
                        """{"items":[${storage.parts.entries.joinToString(
                            ",",
                        ) { """{"partNumber":${it.key},"size":${it.value.size}}""" }}]}""",
                    )
                }

                seen.path.contains("/parts/") && seen.path.endsWith("/url") -> {
                    val number =
                        seen.path
                            .substringAfter("/parts/")
                            .substringBefore("/")
                            .toInt()
                    if (number == 2 && storage.failPartUrlOnce) {
                        storage.failPartUrlOnce = false
                        Reply(503, """{"code":"media_storage_unavailable"}""")
                    } else {
                        val length = if (number == 3) 8 else 16
                        Reply(
                            200,
                            """{"url":"${server!!.origin}/store/$number?X-Amz-Signature=sig","expiresAt":"x","contentLength":$length}""",
                        )
                    }
                }

                seen.path.startsWith("/store/") -> {
                    val number = seen.path.substringAfter("/store/").toInt()
                    storage.parts[number] = seen.body
                    storage.puts[number] = (storage.puts[number] ?: 0) + 1
                    Reply(200, "", mapOf("ETag" to "\"etag-$number\""))
                }

                seen.path.endsWith("/complete") -> {
                    storage.completed = true
                    Reply(200, """{"fileState":"uploaded","stateReasonCode":null}""")
                }

                else -> {
                    Reply(404)
                }
            }
    }.also { server = it }

    @Test
    fun `EVM-130 AC1 the file goes through real HTTP in parts, survives a 503 and a second run sends no part twice`() {
        val storage = Storage()
        val api = serve(storage) { null }
        val files = UploadFiles(root)
        val jobs = JobFileStore(files)
        val original = ByteArray(40) { (it * 7).toByte() }
        files.originalFile(ASSET).apply { parentFile.mkdirs() }.writeBytes(original)
        jobs.arm(JobFileData(ASSET, WORK_ORDER, 40L, "user-1", "device-1", TEST_TYPE, TEST_SHA, null))
        val marker = WipeMarker(files.wipeMarkerFile)
        val config = HttpConfig(api.origin, listOf(api.authority), "1.0.0", e2eCleartext = true, readTimeoutMs = 5_000)
        val cancel = CancelHandle()
        val core = HttpCore(config, cancel, marker)
        val owner = TokenOwner(MemoryVault(), { RefreshAnswer.NoAnswer }, { 1_000_000L }, { LogoutAnswer.UNAVAILABLE })
        owner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        var counter = 0
        val runner =
            UploadJobRunner(jobs, owner, marker, { job ->
                UploadEngine(
                    UploadEngineDeps(
                        api = HttpUploadApi(core, owner, { }, job.workOrderId, job.assetId),
                        transport = HttpPartTransport(core, cancel, marker, files.originalFile(job.assetId)),
                        store = jobs,
                        allowedHosts = listOf(api.authority),
                        sleeper = { },
                        random = { 0.5 },
                        ids = { "0193a000-0000-7000-8000-%012d".format(++counter) },
                        stop = marker,
                        allowCleartextPartUrls = true,
                    ),
                )
            })
        // the 503 on the address of part 2 is retried inside the run (backoff without a real wait); the file goes through
        assertEquals(JobResult.Finished, runner.run(ASSET))
        assertTrue(storage.completed)
        assertEquals(mapOf(1 to 1, 2 to 1, 3 to 1), storage.puts)
        assertEquals(original.toList(), storage.parts.values.flatMap { it.toList() })
        assertEquals(JobState.UPLOADED, jobs.read(ASSET)?.snapshot?.state)
        assertEquals(JobResult.Finished, runner.run(ASSET))
        assertEquals(mapOf(1 to 1, 2 to 1, 3 to 1), storage.puts)
        // EVM-131: every createSession carries the same declaration of the file (the name is the asset's, never a user's)
        val sessions = api.requests.filter { it.method == "POST" && it.path.endsWith("/upload-sessions") }
        assertTrue(sessions.isNotEmpty())
        for (seen in sessions) {
            val body = Json.obj(Json.parse(String(seen.body)))
            val file = Json.obj(body["file"])
            assertEquals(mapOf("fileName" to "$ASSET.jpg", "declaredSize" to 40L, "contentType" to TEST_TYPE, "sha256" to TEST_SHA), file)
        }
        assertFalse(files.jobFile(ASSET).readText().contains("access-0"))
        assertFalse(files.jobFile(ASSET).readText().contains("X-Amz"))
    }

    @Test
    fun `EVM-130 AC2 session_revoked from the API pauses the job, and from then on no request carries the old access token`() {
        val storage = Storage()
        val api = serve(storage) { Reply(401, """{"code":"session_revoked"}""") }
        val files = UploadFiles(root)
        val jobs = JobFileStore(files)
        files.originalFile(ASSET).apply { parentFile.mkdirs() }.writeBytes(ByteArray(40))
        jobs.arm(JobFileData(ASSET, WORK_ORDER, 40L, "user-1", "device-1", TEST_TYPE, TEST_SHA, null))
        val marker = WipeMarker(files.wipeMarkerFile)
        val config = HttpConfig(api.origin, listOf(api.authority), "1.0.0", e2eCleartext = true)
        val core = HttpCore(config, CancelHandle(), marker)
        val vault = MemoryVault()
        val owner = TokenOwner(vault, HttpAuthApi(core), { 1_000_000L }, HttpAuthApi(core))
        owner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        val runner =
            UploadJobRunner(jobs, owner, marker, { job ->
                UploadEngine(
                    UploadEngineDeps(
                        api = HttpUploadApi(core, owner, { }, job.workOrderId, job.assetId),
                        transport = HttpPartTransport(core, CancelHandle(), marker, files.originalFile(job.assetId)),
                        store = jobs,
                        allowedHosts = listOf(api.authority),
                        sleeper = { },
                        random = { 0.5 },
                        ids = { "0193a000-0000-7000-8000-000000000001" },
                        stop = marker,
                        allowCleartextPartUrls = true,
                    ),
                )
            })
        assertEquals(JobResult.PausedForSignIn, runner.run(ASSET))
        val sent = api.requests.size
        assertEquals(1, sent)
        assertEquals(JobResult.PausedForSignIn, runner.run(ASSET))
        assertEquals(JobResult.PausedForSignIn, runner.run(ASSET))
        assertEquals(sent, api.requests.size)
        assertEquals(
            pl.eviacharge.upload.session
                .TokenRecord(null, emptyList(), pl.eviacharge.upload.session.EndedBy.REVOKED),
            vault.record,
        )
    }
}
