package pl.eviacharge.upload.schedule

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.TEST_TYPE
import pl.eviacharge.upload.files.FileDigest
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.JobIdRegistry
import pl.eviacharge.upload.files.OriginalVerdict
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.WipeMarker
import pl.eviacharge.upload.runner.RunningJobs
import java.io.File

private const val ASSET = "0193a000-0000-7000-8000-00000000000a"
private const val OTHER = "0193a000-0000-7000-8000-00000000000b"
private const val WORK_ORDER = "0193a000-0000-7000-8000-0000000000d1"

private class FakeSystem : SystemJobs {
    val pending = mutableSetOf<Int>()
    val requests = mutableListOf<JobRequest>()
    val cancelled = mutableListOf<Int>()
    val answers = ArrayDeque<ScheduleResult>()

    override fun isPending(id: Int) = id in pending

    override fun schedule(request: JobRequest): ScheduleResult {
        requests.add(request)
        val answer = answers.removeFirstOrNull() ?: ScheduleResult.SCHEDULED
        if (answer == ScheduleResult.SCHEDULED) pending.add(request.id)
        return answer
    }

    override fun cancel(id: Int) {
        cancelled.add(id)
        pending.remove(id)
    }
}

/** EVM-130 AC1 (architect 7): arming after `applied`, the kind of the job, idempotence; AC4: the end of a job and the original. */
class JobArmingTest {
    @TempDir
    lateinit var root: File

    private val files get() = UploadFiles(root)
    private val system = FakeSystem()
    private var api = 34
    private var visible = true
    private val running = RunningJobs()

    private fun jobs() = JobFileStore(files)

    private fun ids() = JobIdRegistry(files.jobIdsFile)

    private fun arming() = JobArming(files, jobs(), ids(), system, WipeMarker(files.wipeMarkerFile), api) { visible }

    private fun lifecycle() = JobLifecycle(files, ids(), system, running)

    private fun original(
        assetId: String = ASSET,
        size: Int = 40,
    ) {
        files.originalFile(assetId).apply { parentFile.mkdirs() }.writeBytes(ByteArray(size) { it.toByte() })
    }

    private fun item(assetId: String = ASSET) = JobArming.Item(assetId, WORK_ORDER, "user-1", "device-1", TEST_TYPE)

    @Test
    fun `EVM-130 AC1 a file with its original is armed - the job file, a durable id, a user-initiated job on API 34, app visible`() {
        original()
        val result = arming().arm(item())
        assertEquals(ArmResult.Armed(true), result)
        val request = system.requests.single()
        assertEquals(JobIdRegistry.DEFAULT_BASE, request.id)
        assertEquals(40L, request.uploadBytes)
        assertEquals(JobSpec(true, NetworkRequirement.ANY, true), request.spec)
        val job = jobs().read(ASSET)
        assertEquals(40L, job?.size)
        assertEquals("user-1:device-1", job?.ownerId)
        assertNull(job?.snapshot)
    }

    @Test
    fun `EVM-130 AC1 arming twice does not replace a job the system has, force replaces it (the explicit retry)`() {
        original()
        assertEquals(ArmResult.Armed(true), arming().arm(item()))
        assertEquals(ArmResult.AlreadyArmed, arming().arm(item()))
        assertEquals(1, system.requests.size)
        assertEquals(ArmResult.Armed(true), arming().arm(item(), force = true))
        assertEquals(2, system.requests.size)
        assertEquals(system.requests[0].id, system.requests[1].id)
    }

    @Test
    fun `EVM-130 AC1 a regular job when the app is hidden or the system older, Wi-Fi only asks for an unmetered network`() {
        original()
        visible = false
        assertEquals(ArmResult.Armed(false), arming().arm(item(), wifiOnly = true))
        assertEquals(
            NetworkRequirement.UNMETERED,
            system.requests
                .last()
                .spec.network,
        )
        system.pending.clear()
        visible = true
        api = 33
        assertEquals(ArmResult.Armed(false), arming().arm(item()))
        assertTrue(
            system.requests
                .last()
                .spec.persisted,
        )
    }

    @Test
    fun `EVM-130 AC1 after a SecurityException of the user-initiated job the same job is asked again as a regular one`() {
        original()
        system.answers.add(ScheduleResult.REFUSED_USER_INITIATED)
        assertEquals(ArmResult.Armed(false), arming().arm(item()))
        assertEquals(listOf(true, false), system.requests.map { it.spec.userInitiated })
        assertEquals(system.requests[0].id, system.requests[1].id)
        system.pending.clear()
        system.answers.add(ScheduleResult.REFUSED_USER_INITIATED)
        system.answers.add(ScheduleResult.FAILED)
        assertEquals(ArmResult.Failed, arming().arm(item()))
    }

    @Test
    fun `EVM-130 AC1 a refusal of the system is a failure to try again, nothing is claimed`() {
        original()
        system.answers.add(ScheduleResult.FAILED)
        assertEquals(ArmResult.Failed, arming().arm(item()))
    }

    @Test
    fun `EVM-130 AC1 without an original, with a bad identifier or under a wipe marker nothing is armed and nothing is written`() {
        assertEquals(ArmResult.MissingOriginal, arming().arm(item()))
        files.originalFile(ASSET).apply { parentFile.mkdirs() }.writeBytes(ByteArray(0))
        assertEquals(ArmResult.MissingOriginal, arming().arm(item()))
        original()
        assertEquals(ArmResult.Invalid, arming().arm(JobArming.Item("../x", WORK_ORDER, "u", "d", TEST_TYPE)))
        assertEquals(ArmResult.Invalid, arming().arm(JobArming.Item(ASSET, "a/b", "u", "d", TEST_TYPE)))
        assertEquals(ArmResult.Invalid, arming().arm(JobArming.Item(ASSET, WORK_ORDER, "", "d", TEST_TYPE)))
        assertEquals(ArmResult.Invalid, arming().arm(JobArming.Item(ASSET, WORK_ORDER, "u", "d:e", TEST_TYPE)))
        WipeMarker(files.wipeMarkerFile).begin()
        assertEquals(ArmResult.WipeActive, arming().arm(item()))
        assertTrue(system.requests.isEmpty())
        assertNull(jobs().read(ASSET))
    }

    @Test
    fun `EVM-130 AC1 a job file that cannot be written or an exhausted range is a failure, not a crash`() {
        original()
        files.jobsDirectory.parentFile.mkdirs()
        // a FILE where the directory of the jobs must be: the atomic write fails
        files.jobsDirectory.writeText("not a directory")
        assertEquals(ArmResult.Failed, arming().arm(item()))
        files.jobsDirectory.delete()
        val tiny = JobIdRegistry(files.jobIdsFile, range = 1)
        val arming = JobArming(files, jobs(), tiny, system, WipeMarker(files.wipeMarkerFile), 34) { true }
        original(OTHER)
        assertTrue(arming.arm(item()) is ArmResult.Armed)
        assertEquals(ArmResult.Failed, arming.arm(item(OTHER)))
    }

    @Test
    fun `EVM-130 AC1 reconcile arms every file of the list once and reports each, a job after a sign-in is armed again`() {
        original()
        original(OTHER, 8)
        val first = arming().reconcile(listOf(item(), item(OTHER), item("0193a000-0000-7000-8000-00000000000c")))
        assertEquals(ArmResult.Armed(true), first[ASSET])
        assertEquals(ArmResult.Armed(true), first[OTHER])
        assertEquals(ArmResult.MissingOriginal, first["0193a000-0000-7000-8000-00000000000c"])
        val second = arming().reconcile(listOf(item(), item(OTHER)))
        assertEquals(ArmResult.AlreadyArmed, second[ASSET])
        // the job finished as paused (no longer pending): the next reconcile after the sign-in arms it again with the same id
        val id = system.requests[0].id
        system.pending.remove(id)
        assertEquals(ArmResult.Armed(true), arming().reconcile(listOf(item()))[ASSET])
        assertEquals(id, system.requests.last().id)
    }

    @Test
    fun `EVM-130 AC1 the retry hands the same job to the system again even if it waits, and knows no file never armed`() {
        original()
        assertEquals(ArmResult.Invalid, arming().retry(ASSET))
        assertEquals(ArmResult.Invalid, arming().retry("not-an-asset"))
        arming().arm(item())
        assertEquals(ArmResult.Armed(true), arming().retry(ASSET))
        assertEquals(2, system.requests.size)
        assertEquals(ArmResult.Armed(false), arming().apply { visible = false }.retry(ASSET, wifiOnly = true))
        assertEquals(
            NetworkRequirement.UNMETERED,
            system.requests
                .last()
                .spec.network,
        )
    }

    @Test
    fun `EVM-131 AC1 arming writes the declaration into the job file - the allow-listed type and the SHA-256 of the original`() {
        original()
        assertEquals(
            ArmResult.Armed(true),
            arming().arm(
                item().let {
                    JobArming.Item(it.assetId, it.workOrderId, it.userId, it.deviceId, " Image/JPG ")
                },
            ),
        )
        val job = jobs().read(ASSET)
        assertEquals("image/jpeg", job?.contentType)
        assertEquals(FileDigest.sha256Hex(files.originalFile(ASSET)), job?.sha256)
        assertEquals("$ASSET.jpg", job?.declaration?.fileName)
        assertEquals(40L, job?.declaration?.declaredSize)
        // an existing job keeps its declaration: the original is not hashed again and a later change of the file never changes what was declared
        val before = job?.declaration
        files.originalFile(ASSET).writeBytes(ByteArray(40) { 9 })
        system.pending.clear()
        arming().arm(item())
        assertEquals(before, jobs().read(ASSET)?.declaration)
        // "Ponów" keeps the type of the job
        assertEquals(ArmResult.Armed(true), arming().retry(ASSET))
        assertEquals("image/jpeg", jobs().read(ASSET)?.contentType)
    }

    @Test
    fun `EVM-131 AC1 a type outside the allow-list is refused before anything is written`() {
        original()
        for (type in listOf("", "image/svg+xml", "text/html", "application/octet-stream")) {
            assertEquals(ArmResult.Invalid, arming().arm(JobArming.Item(ASSET, WORK_ORDER, "user-1", "device-1", type)), type)
        }
        assertNull(jobs().read(ASSET))
        assertTrue(system.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC1 every answer of arming has a name for the app`() {
        assertEquals("armed_user_initiated", ArmResult.Armed(true).wire())
        assertEquals("armed", ArmResult.Armed(false).wire())
        assertEquals("already_armed", ArmResult.AlreadyArmed.wire())
        assertEquals("missing_original", ArmResult.MissingOriginal.wire())
        assertEquals("invalid", ArmResult.Invalid.wire())
        assertEquals("wipe_active", ArmResult.WipeActive.wire())
        assertEquals("failed", ArmResult.Failed.wire())
    }

    @Test
    fun `EVM-130 AC4 the digest of the original is computed natively as a stream, none without a file`() {
        assertNull(lifecycle().digest(ASSET))
        lifecycle().originalFile(ASSET)
        assertNull(lifecycle().digest(ASSET))
        original()
        val digest = lifecycle().digest(ASSET)
        assertEquals(40L, digest?.sizeBytes)
        assertEquals(FileDigest.sha256Hex(files.originalFile(ASSET)), digest?.sha256Hex)
        assertEquals(64, digest?.sha256Hex?.length)
    }

    @Test
    fun `EVM-130 AC4 the original and the job stay until the server confirms the file, then they go`() {
        original()
        arming().arm(item())
        val id = system.requests.single().id
        for (
        (state, reason, verdict) in
        listOf(
            Triple("uploaded", null, OriginalVerdict.KEEP),
            Triple("scanning", null, OriginalVerdict.KEEP),
            Triple("failed", "checksum_mismatch", OriginalVerdict.KEEP_AND_RETRY),
            Triple("quarantined", null, OriginalVerdict.KEEP_QUARANTINED),
        )
        ) {
            assertEquals(verdict, lifecycle().complete(ASSET, state, reason))
            assertTrue(files.originalFile(ASSET).isFile)
            assertNotNull(jobs().read(ASSET))
        }
        assertEquals(OriginalVerdict.DELETE, lifecycle().complete(ASSET, "clean", null))
        assertFalse(files.originalFile(ASSET).exists())
        assertNull(jobs().read(ASSET))
        assertTrue(id in system.cancelled)
        assertNull(ids().existing(ASSET))
        // done twice is nothing to do
        assertEquals(OriginalVerdict.DELETE, lifecycle().complete(ASSET, "ready", null))
    }

    @Test
    fun `EVM-130 AC5 the user cancels a file - the job stops and goes, the original only on request`() {
        original()
        arming().arm(item())
        val thread = Thread { }
        val handle = running.begin(ASSET, thread)
        assertTrue(lifecycle().cancel(ASSET, deleteOriginal = false))
        assertTrue(handle.cancelled)
        assertNull(jobs().read(ASSET))
        assertTrue(files.originalFile(ASSET).isFile)
        assertTrue(lifecycle().cancel(ASSET, deleteOriginal = true))
        assertFalse(files.originalFile(ASSET).exists())
        // a file that was never armed has no id and nothing in the system
        val before = system.cancelled.size
        assertTrue(lifecycle().cancel(OTHER, deleteOriginal = true))
        assertEquals(before, system.cancelled.size)
    }

    @Test
    fun `EVM-130 AC5 a cancel that cannot remove a file reports it so that the next call tries again`() {
        original()
        arming().arm(item())
        // a DIRECTORY with content where the job file is: it cannot be deleted as a file
        files.jobFile(ASSET).apply {
            delete()
            mkdirs()
            File(this, "x").writeText("x")
        }
        assertFalse(lifecycle().cancel(ASSET, deleteOriginal = true))
    }

    @Test
    fun `EVM-130 AC1 the synthetic file of the e2e hook has the requested size and a content that depends on the seed only`() {
        val a = File(root, "x/a.bin")
        val b = File(root, "b.bin")
        val c = File(root, "c.bin")
        assertTrue(SyntheticFile.write(a, 200_000L, 7))
        assertTrue(SyntheticFile.write(b, 200_000L, 7))
        assertTrue(SyntheticFile.write(c, 200_000L, 8))
        assertEquals(200_000L, a.length())
        assertEquals(FileDigest.sha256Hex(a), FileDigest.sha256Hex(b))
        assertFalse(FileDigest.sha256Hex(a) == FileDigest.sha256Hex(c))
        assertFalse(SyntheticFile.write(File(root, "d.bin"), 0L, 1))
        assertFalse(SyntheticFile.write(File(root, "e.bin"), SyntheticFile.MAX_BYTES + 1, 1))
        assertFalse(File(root, "d.bin").exists())
    }
}
