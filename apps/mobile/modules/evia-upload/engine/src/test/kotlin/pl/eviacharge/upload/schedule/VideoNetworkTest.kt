package pl.eviacharge.upload.schedule

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.SNAPSHOT_SCHEMA_VERSION
import pl.eviacharge.upload.files.JobFileStore
import pl.eviacharge.upload.files.JobIdRegistry
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.files.WipeChain
import pl.eviacharge.upload.files.WipeMarker
import java.io.File

private const val WORK_ORDER = "0193a000-0000-7000-8000-0000000000d1"
private val VIDEO_A = "0193a000-0000-7000-8000-00000000000a"
private val VIDEO_B = "0193a000-0000-7000-8000-00000000000b"
private val PHOTO = "0193a000-0000-7000-8000-00000000000c"

private class Jobs : SystemJobs {
    val pending = mutableSetOf<Int>()
    val requests = mutableListOf<JobRequest>()

    override fun isPending(id: Int) = id in pending

    override fun schedule(request: JobRequest): ScheduleResult {
        requests.add(request)
        pending.add(request.id)
        return ScheduleResult.SCHEDULED
    }

    override fun cancel(id: Int) {
        pending.remove(id)
    }
}

/** EVM-110 AC4 and AC5 (SEC-110-16): the network policy per type of file, the setting of the phone, the gate and the re-arming. */
class VideoNetworkTest {
    @TempDir
    lateinit var root: File

    private val files get() = UploadFiles(root)
    private val system = Jobs()

    private fun arming(settings: UploadSettings) =
        JobArming(
            files,
            JobFileStore(files),
            JobIdRegistry(files.jobIdsFile, 1000, 5),
            system,
            WipeMarker(files.wipeMarkerFile),
            34,
            settings,
        ) {
            true
        }

    private fun item(
        assetId: String,
        type: String,
    ): JobArming.Item {
        files.originalFile(assetId).apply { parentFile.mkdirs() }.writeBytes(ByteArray(40) { it.toByte() })
        return JobArming.Item(assetId, WORK_ORDER, "user-1", "device-1", type)
    }

    private fun network() =
        system.requests
            .last()
            .spec.network

    @Test
    fun `EVM-110 AC4 only a video is held for a network without charges and only while the setting is on`() {
        for (type in listOf("video/mp4", "video/quicktime", "VIDEO/MP4")) {
            assertTrue(SchedulePolicy.requiresUnmetered(type, true), type)
            assertFalse(SchedulePolicy.requiresUnmetered(type, false), type)
        }
        for (type in listOf("image/jpeg", "image/png", "image/heic", "application/octet-stream", "")) {
            assertFalse(SchedulePolicy.requiresUnmetered(type, true), type)
        }
        assertEquals(NetworkRequirement.UNMETERED, SchedulePolicy.decide(34, true, false, true).network)
        assertEquals(NetworkRequirement.ANY, SchedulePolicy.decide(34, true, false, false).network)
    }

    @Test
    fun `EVM-110 AC4 the arming reads the setting - a video asks for an unmetered network, a picture and the video with the setting`() {
        val settings = UploadSettings.Fixed(true)
        arming(settings).arm(item(VIDEO_A, "video/mp4"))
        assertEquals(NetworkRequirement.UNMETERED, network())
        arming(settings).arm(item(PHOTO, "image/jpeg"))
        assertEquals(NetworkRequirement.ANY, network())
        settings.setVideoWifiOnly(false)
        arming(settings).arm(item(VIDEO_B, "video/mp4"))
        assertEquals(NetworkRequirement.ANY, network())
    }

    @Test
    fun `EVM-110 AC4 a change of the setting hands every unfinished video to the system again with the new network, and nothing else`() {
        val settings = UploadSettings.Fixed(true)
        val jobs = JobFileStore(files)
        val arm = arming(settings)
        arm.arm(item(VIDEO_A, "video/mp4"))
        arm.arm(item(VIDEO_B, "video/mp4"))
        arm.arm(item(PHOTO, "image/jpeg"))
        // a video that is already on the server is finished: it is not armed again
        jobs.save(JobSnapshot(SNAPSHOT_SCHEMA_VERSION, VIDEO_B, 40L, "s", "k", 16L, 3, false, JobState.UPLOADED, emptyMap()))
        system.requests.clear()
        settings.setVideoWifiOnly(false)
        assertEquals(1, arm.rearmVideos())
        assertEquals(1, system.requests.size)
        assertEquals(VIDEO_A, system.requests.single().assetId)
        assertEquals(NetworkRequirement.ANY, network())
        system.requests.clear()
        settings.setVideoWifiOnly(true)
        assertEquals(1, arm.rearmVideos())
        assertEquals(NetworkRequirement.UNMETERED, network())
    }

    @Test
    fun `EVM-110 AC4 the setting is durable - a new process reads it, the default and an unreadable file mean on, a failure to write`() {
        val file = File(root, "settings/video-wifi-only.txt")
        assertTrue(FileUploadSettings(file).videoWifiOnly(), "default: on (decision of Konrad)")
        assertTrue(FileUploadSettings(file).setVideoWifiOnly(false))
        assertFalse(FileUploadSettings(file).videoWifiOnly(), "a new instance, as after a restart of the process")
        assertTrue(FileUploadSettings(file).setVideoWifiOnly(true))
        assertTrue(FileUploadSettings(file).videoWifiOnly())
        file.writeText("garbage that is longer than the file may be")
        assertTrue(FileUploadSettings(file).videoWifiOnly(), "an unreadable value is on (fail closed)")
        file.delete()
        file.mkdirs() // a directory in place of the file: neither readable nor writable
        assertTrue(FileUploadSettings(file).videoWifiOnly())
        assertFalse(FileUploadSettings(file).setVideoWifiOnly(false))
    }

    @Test
    fun `EVM-110 AC4 the setting stays after the sign-out and the wipe of the files of the work`() {
        val settings = FileUploadSettings(files.settingsFile)
        settings.setVideoWifiOnly(false)
        val chain = WipeChain(files, WipeMarker(files.wipeMarkerFile), { }, { }, { }, { }, JobIdRegistry(files.jobIdsFile, 1000, 5))
        assertTrue(chain.run())
        assertTrue(files.settingsFile.isFile)
        assertFalse(FileUploadSettings(files.settingsFile).videoWifiOnly())
    }

    @Test
    fun `EVM-110 AC4 AC5 the gate and the waiting state follow the type, the setting and the network - an unknown network counts as`() {
        var unmetered: Boolean? = true
        val settings = UploadSettings.Fixed(true)
        val policy = VideoNetworkPolicy(settings) { unmetered }
        assertTrue(policy.gateFor("video/mp4").allowsPart())
        assertFalse(policy.waitsForWifi("video/mp4"))
        unmetered = false
        assertFalse(policy.gateFor("video/mp4").allowsPart())
        assertTrue(policy.waitsForWifi("video/mp4"))
        assertTrue(policy.gateFor("image/jpeg").allowsPart(), "pictures and entries are never held")
        assertFalse(policy.waitsForWifi("image/jpeg"))
        unmetered = null
        assertFalse(policy.gateFor("video/mp4").allowsPart())
        assertTrue(policy.waitsForWifi("video/mp4"))
        settings.setVideoWifiOnly(false)
        assertTrue(policy.gateFor("video/mp4").allowsPart())
        assertFalse(policy.waitsForWifi("video/mp4"))
        assertTrue(VideoNetworkPolicy.OPEN.gateFor("video/mp4").allowsPart())
    }
}
