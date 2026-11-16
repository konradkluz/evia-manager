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
import pl.eviacharge.upload.RedactingLogger
import pl.eviacharge.upload.TEST_SHA
import pl.eviacharge.upload.TEST_TYPE
import pl.eviacharge.upload.files.ContactSink
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.http.HttpAuthApi
import pl.eviacharge.upload.http.HttpConfig
import pl.eviacharge.upload.http.HttpCore
import pl.eviacharge.upload.http.Reply
import pl.eviacharge.upload.http.TestServer
import pl.eviacharge.upload.notification.Notice
import pl.eviacharge.upload.schedule.UploadSettings
import pl.eviacharge.upload.schedule.VideoNetworkPolicy
import pl.eviacharge.upload.session.LogoutAnswer
import pl.eviacharge.upload.session.MemoryVault
import pl.eviacharge.upload.session.RefreshAnswer
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenOwner
import java.io.File

private const val ASSET = "0193a000-0000-7000-8000-00000000000a"
private const val OTHER = "0193a000-0000-7000-8000-00000000000b"
private const val WORK_ORDER = "0193a000-0000-7000-8000-0000000000d1"
private const val OWNER = "user-1:device-1"

private class Heard : UploadReporter {
    val progress = mutableListOf<JobStatus>()
    val finished = mutableListOf<Triple<String, JobResult, SessionState?>>()
    var failFinished = false

    override fun progress(status: JobStatus) {
        progress.add(status)
    }

    override fun finished(
        assetId: String,
        result: JobResult,
        session: SessionState?,
    ) {
        finished.add(Triple(assetId, result, session))
        if (failFinished) throw IllegalStateException("not listening")
    }
}

/** EVM-130 AC1, AC2, AC5, AC6: the work around one run (what the JobService calls) through real HTTP, with the engine factory. */
class UploadWorkerTest {
    @TempDir
    lateinit var root: File

    private var server: TestServer? = null
    private val heard = Heard()
    private val running = RunningJobs()

    @AfterEach
    fun tearDown() {
        server?.close()
    }

    private class Wiring(
        val worker: UploadWorker,
        val jobs: JobFileStore,
        val owner: TokenOwner,
        val marker: WipeMarker,
        val files: UploadFiles,
    )

    private fun wiring(answer: (String) -> Reply): Wiring = wiringWith(answer, VideoNetworkPolicy.OPEN)

    private fun wiringWith(
        answer: (String) -> Reply,
        network: VideoNetworkPolicy,
    ): Wiring {
        val api = TestServer { seen -> answer(seen.path) }.also { server = it }
        val files = UploadFiles(root)
        val jobs = JobFileStore(files)
        val marker = WipeMarker(files.wipeMarkerFile)
        val config = HttpConfig(api.origin, listOf(api.authority), "1.0.0", e2eCleartext = true, readTimeoutMs = 5_000)
        val authCore = HttpCore(config, CancelHandle(), marker)
        val owner = TokenOwner(MemoryVault(), HttpAuthApi(authCore), { System.nanoTime() / 1_000_000 }, HttpAuthApi(authCore))
        owner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        val store = ProgressStore(jobs, ProgressThrottle({ 0L }, 0L)) { heard.progress.add(it) }
        val factory = EngineFactory(config, owner, files, store, marker, ContactSink.NONE, running, sleeper = { }, network = network)
        val runner = UploadJobRunner(jobs, owner, marker, { job: JobFileData -> factory.create(job) }, RedactingLogger.NONE)
        return Wiring(UploadWorker(runner, jobs, running, marker, owner, heard, network = network), jobs, owner, marker, files)
    }

    private fun storageServer(storage: MutableMap<Int, ByteArray>): (String) -> Reply =
        { path ->
            when {
                path.endsWith("/upload-sessions") -> {
                    Reply(201, """{"id":"sess-1","partSize":16,"partCount":3}""")
                }

                path.endsWith("/parts") -> {
                    Reply(200, """{"items":[]}""")
                }

                path.endsWith("/url") -> {
                    val number = path.substringAfter("/parts/").substringBefore("/").toInt()
                    Reply(
                        200,
                        """{"url":"${server!!.origin}/store/$number?X-Amz-Signature=sig","expiresAt":"x","contentLength":${if (number == 3) 8 else 16}}""",
                    )
                }

                path.startsWith("/store/") -> {
                    storage[path.substringAfter("/store/").toInt()] = ByteArray(0)
                    Reply(200, "", mapOf("ETag" to "\"etag\""))
                }

                path.endsWith("/complete") -> {
                    Reply(200, """{"fileState":"uploaded","stateReasonCode":null}""")
                }

                else -> {
                    Reply(404)
                }
            }
        }

    private fun arm(
        wiring: Wiring,
        assetId: String = ASSET,
        userId: String = "user-1",
    ) {
        wiring.files
            .originalFile(assetId)
            .apply { parentFile.mkdirs() }
            .writeBytes(ByteArray(40) { it.toByte() })
        wiring.jobs.arm(JobFileData(assetId, WORK_ORDER, 40L, userId, "device-1", TEST_TYPE, TEST_SHA, null))
    }

    private fun armVideo(
        wiring: Wiring,
        assetId: String = ASSET,
    ) {
        wiring.files
            .originalFile(assetId)
            .apply { parentFile.mkdirs() }
            .writeBytes(ByteArray(40) { it.toByte() })
        wiring.jobs.arm(JobFileData(assetId, WORK_ORDER, 40L, "user-1", "device-1", "video/mp4", TEST_SHA, null))
    }

    @Test
    fun `EVM-110 AC4 AC5 a video waits for Wi-Fi without an error, a picture goes through the same network, and the video goes when`() {
        val storage = mutableMapOf<Int, ByteArray>()
        var unmetered: Boolean? = false
        val settings = UploadSettings.Fixed(true)
        val w = wiringWith(storageServer(storage), VideoNetworkPolicy(settings) { unmetered })
        val picture = "0193a000-0000-7000-8000-00000000000b"
        armVideo(w)
        arm(w, picture)
        // statuses: the video waits for Wi-Fi, the picture does not
        assertEquals(mapOf(ASSET to true, picture to false), w.worker.statuses().associate { it.assetId to it.waitingForWifi })
        begin(w, picture)
        assertEquals(JobResult.Finished, w.worker.execute(picture))
        assertEquals(setOf(1, 2, 3), storage.keys)
        storage.clear()
        begin(w)
        assertEquals(JobResult.WaitingForWifi, w.worker.execute(ASSET))
        assertTrue(storage.isEmpty(), "zero parts over a network with charges")
        assertEquals("queued" to "waiting_wifi", JobOutcomes.fileState(JobResult.WaitingForWifi))
        assertTrue(JobOutcomes.wantsReschedule(JobResult.WaitingForWifi))
        assertFalse(JobOutcomes.concernsSession(JobResult.WaitingForWifi))
        // not a failure: no "needs attention" in the notice tally
        assertEquals(1, w.worker.statuses().count { it.waitingForWifi })
        assertFalse(
            w.worker
                .notice()
                ?.text
                ?.contains("Nie wysłano", ignoreCase = true) == true,
        )
        // an unknown network is "with charges" for a held video; the setting turned off lets it go through any network
        unmetered = null
        begin(w)
        assertEquals(JobResult.WaitingForWifi, w.worker.execute(ASSET))
        settings.setVideoWifiOnly(false)
        unmetered = false
        assertFalse(
            w.worker
                .statuses()
                .first { it.assetId == ASSET }
                .waitingForWifi,
        )
        begin(w)
        assertEquals(JobResult.Finished, w.worker.execute(ASSET))
        assertEquals(setOf(1, 2, 3), storage.keys)
    }

    private fun begin(
        wiring: Wiring,
        assetId: String = ASSET,
    ): Thread {
        val thread = Thread.currentThread()
        wiring.worker.begin(assetId, thread)
        return thread
    }

    @Test
    fun `EVM-130 AC1 a run sends the file, reports the progress and the end, and the notification says sent`() {
        val storage = mutableMapOf<Int, ByteArray>()
        val w = wiring(storageServer(storage))
        arm(w)
        begin(w)
        assertEquals(JobResult.Finished, w.worker.execute(ASSET))
        assertEquals(setOf(1, 2, 3), storage.keys)
        assertEquals(listOf(Triple(ASSET, JobResult.Finished, null)), heard.finished)
        assertTrue(heard.progress.isNotEmpty())
        assertEquals(100, heard.progress.last().percent)
        assertFalse(running.isRunning(ASSET))
        assertEquals(Notice("Wysłano 1 plik", false), w.worker.notice())
        assertEquals(listOf(FileJobState.UPLOADED), w.worker.statuses().map { it.state })
    }

    @Test
    fun `EVM-130 AC6 while a job runs the notice is the progress, and a job of the system that was started counts as running`() {
        val w = wiring(storageServer(mutableMapOf()))
        arm(w)
        w.worker.begin(ASSET, Thread { })
        assertEquals(Notice("Wysyłanie 0 z 1 pliku", true), w.worker.notice())
        assertEquals(
            FileJobState.UPLOADING,
            w.worker
                .statuses()
                .single()
                .state,
        )
    }

    @Test
    fun `EVM-130 AC5 a stop before the engine exists ends the run as stopped with no request, and asks for a new schedule`() {
        val w = wiring(storageServer(mutableMapOf()))
        arm(w)
        w.worker.begin(ASSET, Thread { })
        assertTrue(w.worker.onStop(ASSET))
        assertEquals(JobResult.Stopped, w.worker.execute(ASSET))
        assertTrue(server!!.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC5 after the wipe marker a stop does not ask for a schedule, and a run sends nothing`() {
        val w = wiring(storageServer(mutableMapOf()))
        arm(w)
        w.marker.begin()
        w.worker.begin(ASSET, Thread { })
        assertFalse(w.worker.onStop(ASSET))
        assertEquals(JobResult.DeviceWipe, w.worker.execute(ASSET))
        assertEquals(SessionState.SIGNED_IN, heard.finished.single().third)
        assertTrue(server!!.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 session_revoked pauses the work - the notice says paused, and the app hears the state of the session`() {
        val w = wiring { Reply(401, """{"code":"session_revoked"}""") }
        arm(w)
        begin(w)
        assertEquals(JobResult.PausedForSignIn, w.worker.execute(ASSET))
        assertEquals(SessionState.PAUSED_REVOKED, heard.finished.single().third)
        assertEquals(Notice("Wysyłanie wstrzymane — zaloguj się w aplikacji", false), w.worker.notice())
        assertEquals(
            FileJobState.PAUSED_REVOKED,
            w.worker
                .statuses()
                .single()
                .state,
        )
    }

    @Test
    fun `EVM-130 AC6 a file that needs attention is counted once in the notice, and a later success removes it from the tally`() {
        var broken = true
        val storage = mutableMapOf<Int, ByteArray>()
        val ok = storageServer(storage)
        val w = wiring { path -> if (broken && path.endsWith("/upload-sessions")) Reply(409, """{"code":"id_conflict"}""") else ok(path) }
        arm(w)
        begin(w)
        assertEquals(JobResult.NeedsAttention(AttentionReason.ID_CONFLICT), w.worker.execute(ASSET))
        assertEquals(Notice("Nie wysłano 1 pliku — otwórz aplikację", false), w.worker.notice())
        w.worker.forget(ASSET)
        assertNull(w.worker.notice())
        broken = false
        begin(w)
        assertEquals(JobResult.Finished, w.worker.execute(ASSET))
        assertEquals(Notice("Wysłano 1 plik", false), w.worker.notice())
    }

    @Test
    fun `EVM-130 AC5 a job of another owner is refused and never sent, an unexpected failure is needs_attention and nothing throws`() {
        val w = wiring(storageServer(mutableMapOf()))
        arm(w, OTHER, userId = "user-2")
        begin(w, OTHER)
        assertEquals(JobResult.WrongOwner, w.worker.execute(OTHER))
        assertTrue(server!!.requests.isEmpty())
        // a runner whose engine factory blows up: the worker survives and says needs_attention(unknown)
        val files = UploadFiles(root)
        val jobs = JobFileStore(files)
        val marker = WipeMarker(files.wipeMarkerFile)
        val owner = TokenOwner(MemoryVault(), { RefreshAnswer.NoAnswer }, { 0L }, { LogoutAnswer.UNAVAILABLE })
        owner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        val lines = mutableListOf<String>()
        val boom =
            UploadJobRunner(
                jobs,
                owner,
                marker,
                { _: JobFileData -> throw IllegalStateException("https://x/?X-Amz-Signature=abc") },
                RedactingLogger.NONE,
            )
        val worker = UploadWorker(boom, jobs, running, marker, owner, heard, RedactingLogger { lines.add(it) })
        arm(w)
        begin(w)
        val result = worker.execute(ASSET)
        assertEquals(JobResult.NeedsAttention(AttentionReason.UNKNOWN), result)
        assertEquals(listOf("worker_failed error=IllegalStateException"), lines)
        assertFalse(lines.joinToString().contains("Amz"))
        // a listener that fails does not fail the run either
        heard.failFinished = true
        begin(w)
        assertEquals(JobResult.NeedsAttention(AttentionReason.UNKNOWN), worker.execute(ASSET))
        assertEquals("report_failed error=IllegalStateException", lines.last())
    }

    @Test
    fun `EVM-130 AC1 a thread that could not be started is taken off the list of running jobs`() {
        val w = wiring(storageServer(mutableMapOf()))
        arm(w)
        val thread = Thread { }
        w.worker.begin(ASSET, thread)
        assertTrue(running.isRunning(ASSET))
        w.worker.abandon(ASSET, thread)
        assertFalse(running.isRunning(ASSET))
    }

    @Test
    fun `EVM-130 AC6 nothing to say when no file is armed and the queue is empty`() {
        val w = wiring(storageServer(mutableMapOf()))
        assertNull(w.worker.notice())
        assertTrue(w.worker.statuses().isEmpty())
    }
}
