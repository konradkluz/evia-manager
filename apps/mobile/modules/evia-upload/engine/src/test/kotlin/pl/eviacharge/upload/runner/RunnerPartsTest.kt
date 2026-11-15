package pl.eviacharge.upload.runner

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.AttentionReason
import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.JobStore
import pl.eviacharge.upload.TEST_SHA
import pl.eviacharge.upload.TEST_TYPE
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.files.JobFileData
import pl.eviacharge.upload.notification.JobNotification
import pl.eviacharge.upload.notification.Notice
import pl.eviacharge.upload.notification.NotificationPlanner
import pl.eviacharge.upload.notification.NotificationText
import pl.eviacharge.upload.session.SessionState
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val ASSET = "0193a000-0000-7000-8000-00000000000a"
private const val OTHER = "0193a000-0000-7000-8000-00000000000b"

private fun snapshot(
    state: JobState = JobState.ACTIVE,
    parts: Int? = 4,
    done: Int = 0,
) = JobSnapshot(1, ASSET, 100L, "sess", "key", 25L, parts, false, state, (1..done).associate { it.toString() to "\"e$it\"" })

/** EVM-130 AC1, AC5, AC6: the jobs of this process, what a status says, and what a finished run means (pure Kotlin of the glue). */
class RunnerPartsTest {
    @Test
    fun `EVM-130 AC1 a stop reaches a job registered before its engine exists - the handle is made by begin`() {
        val running = RunningJobs()
        val thread = Thread { }
        val handle = running.begin(ASSET, thread)
        assertSame(handle, running.handle(ASSET))
        assertTrue(running.isRunning(ASSET))
        assertEquals(1, running.count())
        assertTrue(running.stop(ASSET))
        assertTrue(handle.cancelled)
        assertTrue(thread.isInterrupted)
        assertFalse(running.stop(OTHER))
        assertNull(running.handle(OTHER))
    }

    @Test
    fun `EVM-130 AC5 stopAll cancels and interrupts every running job (the wipe), and end of an older thread leaves a newer job alone`() {
        val running = RunningJobs()
        val first = Thread { }
        val second = Thread { }
        val one = running.begin(ASSET, first)
        val two = running.begin(OTHER, second)
        running.stopAll()
        assertTrue(one.cancelled)
        assertTrue(two.cancelled)
        assertTrue(first.isInterrupted && second.isInterrupted)
        val replacement = Thread { }
        running.begin(ASSET, replacement)
        running.end(ASSET, first)
        assertTrue(running.isRunning(ASSET))
        running.end(ASSET, replacement)
        assertFalse(running.isRunning(ASSET))
    }

    @Test
    fun `EVM-130 AC4 the status of a file - queued, uploading, a percent of the confirmed parts, uploaded, paused`() {
        val fresh = JobFileData(ASSET, "wo", 100L, "u", "d", TEST_TYPE, TEST_SHA, null)
        assertEquals(JobStatus(ASSET, FileJobState.QUEUED, 0, 0, 0, 100L), JobStatuses.of(fresh, running = false))
        assertEquals(FileJobState.UPLOADING, JobStatuses.of(fresh, running = true).state)
        val half = fresh.copy(snapshot = snapshot(done = 2))
        assertEquals(JobStatus(ASSET, FileJobState.QUEUED, 2, 4, 50, 100L), JobStatuses.of(half, false))
        assertEquals(JobStatus(ASSET, FileJobState.UPLOADING, 2, 4, 50, 100L), JobStatuses.of(half, true))
        val done = fresh.copy(snapshot = snapshot(JobState.UPLOADED, done = 3))
        assertEquals(JobStatus(ASSET, FileJobState.UPLOADED, 4, 4, 100, 100L), JobStatuses.of(done, false))
        val paused = fresh.copy(snapshot = snapshot(JobState.PAUSED_REVOKED, done = 1))
        assertEquals(FileJobState.PAUSED_REVOKED, JobStatuses.of(paused, true).state)
        // a partCount that is not known yet and more ETags than parts never give a percent above 100 or a division by zero
        assertEquals(0, JobStatuses.of(fresh.copy(snapshot = snapshot(parts = null, done = 2)), true).percent)
        assertEquals(100, JobStatuses.ofSnapshot(snapshot(parts = 2, done = 4)).percent)
        assertEquals(listOf("queued", "uploading", "uploaded", "paused_revoked"), FileJobState.entries.map { it.wire })
    }

    @Test
    fun `EVM-130 AC1 only a run that can go on asks the system for a new schedule`() {
        val again = listOf(JobResult.Retry(500L), JobResult.Retry(null), JobResult.RetryChecksum, JobResult.Stopped)
        val over =
            listOf(
                JobResult.Finished,
                JobResult.PausedForSignIn,
                JobResult.PausedForUpdate,
                JobResult.WrongOwner,
                JobResult.NeedsAttention(AttentionReason.QUARANTINED),
                JobResult.DeviceWipe,
                JobResult.Dropped,
            )
        assertTrue(again.all { JobOutcomes.wantsReschedule(it) })
        assertTrue(over.none { JobOutcomes.wantsReschedule(it) })
    }

    @Test
    fun `EVM-130 AC4 every result has a wire state for the app, and only a few concern the session`() {
        assertEquals("uploaded" to null, JobOutcomes.fileState(JobResult.Finished))
        assertEquals("queued" to null, JobOutcomes.fileState(JobResult.Retry(1L)))
        assertEquals("queued" to null, JobOutcomes.fileState(JobResult.Stopped))
        assertEquals("queued" to "checksum_mismatch", JobOutcomes.fileState(JobResult.RetryChecksum))
        assertEquals("paused_revoked" to null, JobOutcomes.fileState(JobResult.PausedForSignIn))
        assertEquals("paused_update" to null, JobOutcomes.fileState(JobResult.PausedForUpdate))
        assertEquals("wrong_owner" to null, JobOutcomes.fileState(JobResult.WrongOwner))
        assertEquals("needs_attention" to "id_conflict", JobOutcomes.fileState(JobResult.NeedsAttention(AttentionReason.ID_CONFLICT)))
        assertEquals("wiped" to null, JobOutcomes.fileState(JobResult.DeviceWipe))
        assertEquals("dropped" to null, JobOutcomes.fileState(JobResult.Dropped))
        assertTrue(JobOutcomes.concernsSession(JobResult.PausedForSignIn))
        assertTrue(JobOutcomes.concernsSession(JobResult.PausedForUpdate))
        assertTrue(JobOutcomes.concernsSession(JobResult.DeviceWipe))
        assertFalse(JobOutcomes.concernsSession(JobResult.Finished))
        assertFalse(JobOutcomes.concernsSession(JobResult.WrongOwner))
    }

    @Test
    fun `EVM-130 AC5 the session states have stable wire names`() {
        val wire = SessionState.entries.map { JobOutcomes.sessionWire(it) }
        assertEquals(listOf("signed_out", "signed_in", "needs_login", "paused_revoked", "paused_update", "wipe_required"), wire)
    }

    @Test
    fun `EVM-130 AC1 the throttle lets one event per second through, a forced one always, and each asset has its own clock`() {
        var now = 10_000L
        val throttle = ProgressThrottle({ now }, 1_000L)
        assertTrue(throttle.allow(ASSET, false))
        now += 999
        assertFalse(throttle.allow(ASSET, false))
        assertTrue(throttle.allow(ASSET, true))
        assertTrue(throttle.allow(OTHER, false))
        now += 1_000
        assertTrue(throttle.allow(ASSET, false))
        // a clock that went backwards (never the monotonic one, but) does not freeze the events
        now -= 5_000
        assertTrue(throttle.allow(ASSET, false))
        assertEquals(1_000L, ProgressThrottle.DEFAULT_INTERVAL_MS)
    }

    private class Memory : JobStore {
        val saved = mutableListOf<JobSnapshot>()
        var failSave = false

        override fun load(assetId: String): JobSnapshot? = saved.lastOrNull()

        override fun save(snapshot: JobSnapshot) {
            if (failSave) error("disk")
            saved.add(snapshot)
        }

        override fun clear(assetId: String) {
            saved.clear()
        }
    }

    @Test
    fun `EVM-130 AC1 progress is reported after the snapshot is saved, throttled, and the end of a file and a pause always pass`() {
        var now = 0L
        val memory = Memory()
        val seen = mutableListOf<JobStatus>()
        val store = ProgressStore(memory, ProgressThrottle({ now }, 1_000L)) { seen.add(it) }
        store.save(snapshot(done = 1))
        store.save(snapshot(done = 2))
        assertEquals(2, memory.saved.size)
        assertEquals(listOf(25), seen.map { it.percent })
        now += 1_000
        store.save(snapshot(done = 3))
        store.save(snapshot(done = 4))
        assertEquals(listOf(25, 75, 100), seen.map { it.percent })
        store.save(snapshot(JobState.PAUSED_REVOKED, done = 1))
        assertEquals(FileJobState.PAUSED_REVOKED, seen.last().state)
        assertEquals(snapshot(JobState.PAUSED_REVOKED, done = 1), store.load(ASSET))
        store.clear(ASSET)
        assertTrue(memory.saved.isEmpty())
    }

    @Test
    fun `EVM-130 AC1 a listener that fails never fails the save, and a failed save reports nothing`() {
        val memory = Memory()
        val seen = mutableListOf<JobStatus>()
        val store = ProgressStore(memory, ProgressThrottle({ 0L }, 1_000L)) { throw IllegalStateException("not listening") }
        store.save(snapshot(done = 1))
        assertEquals(1, memory.saved.size)
        val quiet = ProgressStore(memory, ProgressThrottle({ 0L }, 1_000L)) { seen.add(it) }
        memory.failSave = true
        assertThrows(IllegalStateException::class.java) { quiet.save(snapshot(done = 2)) }
        assertTrue(seen.isEmpty())
    }

    @Test
    fun `EVM-130 AC6 the notification comes from counts only - progress while running, then paused, failed or sent, else none`() {
        assertEquals(Notice("Wysyłanie 3 z 12 plików", true), NotificationPlanner.plan(12, 3, 0, paused = false, running = true))
        assertEquals(Notice(NotificationText.progress(0, 1), true), NotificationPlanner.plan(0, 0, 0, paused = false, running = true))
        assertEquals(Notice(NotificationText.progress(2, 2), true), NotificationPlanner.plan(2, 5, 0, paused = false, running = true))
        assertEquals(Notice(NotificationText.PAUSED, false), NotificationPlanner.plan(12, 3, 1, paused = true, running = false))
        assertEquals(
            Notice("Nie wysłano 2 plików — otwórz aplikację", false),
            NotificationPlanner.plan(12, 3, 2, paused = false, running = false),
        )
        assertEquals(Notice("Wysłano 12 plików", false), NotificationPlanner.plan(12, 12, 0, paused = false, running = false))
        assertNull(NotificationPlanner.plan(12, 3, 0, paused = false, running = false))
        assertNull(NotificationPlanner.plan(0, 0, 0, paused = false, running = false))
    }

    @Test
    fun `EVM-130 AC6 a user-initiated job always has a notice, a closing state stays after the job, a regular job withdraws its own`() {
        val progress = Notice("Wysyłanie 1 z 2 plików", true)
        val closing = Notice("Wysłano 2 pliki", false)
        assertEquals(JobNotification(progress, keepAfterJob = false, withdraw = false), NotificationPlanner.forJob(progress, true))
        assertEquals(JobNotification(closing, keepAfterJob = true, withdraw = false), NotificationPlanner.forJob(closing, false))
        val fallback = Notice(NotificationText.progress(0, 1), true)
        assertEquals(JobNotification(fallback, keepAfterJob = false, withdraw = false), NotificationPlanner.forJob(null, true))
        assertEquals(JobNotification(fallback, keepAfterJob = false, withdraw = true), NotificationPlanner.forJob(null, false))
    }

    @Test
    fun `EVM-130 AC1 the sleep of the backoff is a cancellation when interrupted, never a failure of the network`() {
        ThreadSleeper.sleep(1L)
        val ready = CountDownLatch(1)
        var thrown: Throwable? = null
        var flag = false
        val thread =
            Thread {
                ready.countDown()
                try {
                    ThreadSleeper.sleep(30_000L)
                } catch (error: UploadCancelledException) {
                    thrown = error
                    flag = Thread.currentThread().isInterrupted
                }
            }
        thread.start()
        assertTrue(ready.await(5, TimeUnit.SECONDS))
        thread.interrupt()
        thread.join(5_000)
        assertNotNull(thrown)
        assertTrue(flag)
        assertTrue(ThreadRandom.nextDouble() in 0.0..1.0)
    }

    @Test
    fun `EVM-130 AC1 identifiers are UUIDv7 - the time first, version 7, the RFC variant, unique`() {
        var now = 0x0193a0001234L
        val source = UuidV7Source({ now }, SecureRandom())
        val first = source.newId()
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(first), first)
        assertTrue(first.startsWith("0193a000-1234-7"))
        now += 1
        assertTrue(source.newId() > first)
        assertEquals(1000, (1..1000).map { UuidV7Source().newId() }.toSet().size)
    }
}
