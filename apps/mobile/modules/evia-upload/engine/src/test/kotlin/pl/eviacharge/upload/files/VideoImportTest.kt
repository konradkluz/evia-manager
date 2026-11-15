package pl.eviacharge.upload.files

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.schedule.JobLifecycle
import java.io.File
import java.io.IOException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.Path

private const val ASSET = "0193a000-0000-7000-8000-000000000001"
private const val CAMERA_VIDEO = "3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4"
private const val CAMERA_PHOTO = "3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.jpg"
private const val OLD = 1_000_000_000_000L
private const val MINUTE = 60_000L

/** A minimal MP4: a box of 24 bytes `ftyp` + `isom`, then some payload. */
private fun mp4(payload: Int = 16): ByteArray =
    byteArrayOf(
        0,
        0,
        0,
        24,
        'f'.code.toByte(),
        't'.code.toByte(),
        'y'.code.toByte(),
        'p'.code.toByte(),
        'i'.code.toByte(),
        's'.code.toByte(),
        'o'.code.toByte(),
        'm'.code.toByte(),
    ) +
        ByteArray(12) + ByteArray(payload) { it.toByte() }

/**
 * EVM-110 (SEC-110-05, -06, -07, -11): the import of a recorded video is a MOVE into `originals/<assetId>.mp4` - checked source, `ftyp` at offset 4,
 * size 1..limit, one file store, no replacing, no copy, no hard link; the sweep and the cleaning know `.mp4`.
 */
class VideoImportTest {
    @TempDir
    lateinit var root: File

    private var wipe = false
    private var clock = OLD + 3_600_000
    private val moves = mutableListOf<Pair<Path, Path>>()

    private val files get() = UploadFiles(File(root, "upload"), File(root, "cache/Camera"))
    private val camera get() = files.cameraDirectory

    private fun importer(
        move: (Path, Path) -> Unit = { source, target -> Files.move(source, target) },
        sameStore: (Path, Path) -> Boolean = { first, second -> Files.getFileStore(first) == Files.getFileStore(second) },
        limit: Long = OriginalImporter.VIDEO_MAX_BYTES,
    ) = OriginalImporter(
        files,
        { wipe },
        { Long.MAX_VALUE },
        { clock },
        copy = { _, _ -> throw AssertionError("a video is never copied") },
        link = { _, _ -> throw AssertionError("a video is never linked") },
        move = { source, target ->
            moves.add(source to target)
            move(source, target)
        },
        sameStore = sameStore,
        videoMaxBytes = limit,
    )

    private fun video(
        name: String = CAMERA_VIDEO,
        bytes: ByteArray = mp4(),
    ): File = File(camera, name).apply { parentFile.mkdirs() }.also { it.writeBytes(bytes) }

    private fun uri(file: File) =
        file
            .toURI()
            .toString()
            .replace("file:/", "file:///")
            .replace("file://///", "file:///")

    private fun import(
        source: File,
        assetId: String = ASSET,
        importer: OriginalImporter = importer(),
    ) = importer.import(assetId, uri(source), MediaKind.VIDEO)

    private fun target() = files.videoOriginalFile(ASSET)

    @Test
    fun `EVM-110 AC1 SEC-110-05 the kind comes from the mode of the camera by name only - anything else is not a kind`() {
        assertEquals(MediaKind.VIDEO, MediaKind.fromWire("video"))
        assertEquals(MediaKind.PHOTO, MediaKind.fromWire("photo"))
        for (name in listOf("", "Video", "mp4", "video/mp4", "../photo", "image")) assertEquals(null, MediaKind.fromWire(name), name)
    }

    @Test
    fun `EVM-110 AC1 a recorded video is moved into the originals as the asset mp4 - same bytes, the source gone, no copy and no link`() {
        val bytes = mp4(1000)
        val source = video(bytes = bytes)
        assertEquals(ImportResult.OK, import(source))
        assertFalse(source.exists())
        assertArrayEquals(bytes, target().readBytes())
        assertEquals("$ASSET.mp4", target().name)
        assertEquals(1, moves.size)
        // every consumer of the original finds the video without knowing the type
        assertEquals(target(), files.originalFile(ASSET))
        assertEquals(listOf(target().name), files.originalsDirectory.list()!!.toList())
    }

    @Test
    fun `EVM-110 AC1 the digest of the video is computed natively as a stream and is the digest of the moved file`() {
        val bytes = mp4(300_000)
        import(video(bytes = bytes))
        val lifecycle =
            JobLifecycle(
                files,
                JobIdRegistry(files.jobIdsFile, 1000, 5),
                NoSystem,
                pl.eviacharge.upload.runner
                    .RunningJobs(),
            )
        val digest = lifecycle.digest(ASSET)!!
        assertEquals(bytes.size.toLong(), digest.sizeBytes)
        assertEquals(FileDigest.sha256Hex(bytes.inputStream()), digest.sha256Hex)
    }

    @Test
    fun `EVM-110 AC1 SEC-110-06 the content is checked - ftyp at offset 4, a sane box size, 1 byte up to the limit, anything else is`() {
        val jpegAsMp4 = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0, 0, 0, 1, 2)
        val ftypAtZero = "ftyp".toByteArray() + ByteArray(12)
        val tinyBox = byteArrayOf(0, 0, 0, 4, 'f'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte(), 'p'.code.toByte(), 0, 0)
        val short = byteArrayOf(0, 0, 0, 24, 'f'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte())
        for ((name, bytes) in listOf(
            "empty" to ByteArray(0),
            "jpeg" to jpegAsMp4,
            "ftyp at 0" to ftypAtZero,
            "tiny box" to tinyBox,
            "short" to short,
        )) {
            val source = video(bytes = bytes)
            assertEquals(ImportResult.INVALID, import(source), name)
            assertFalse(source.exists(), name)
            assertFalse(target().exists(), name)
        }
        assertTrue(moves.isEmpty())
    }

    @Test
    fun `EVM-110 AC2 SEC-110-06 the size limit - the limit itself passes, one byte more does not, and the limit is below the`() {
        val limit = 40L
        assertEquals(ImportResult.OK, import(video(bytes = mp4(limit.toInt() - 24)), importer = importer(limit = limit)))
        File(files.originalsDirectory, "$ASSET.mp4").delete()
        val over = video(bytes = mp4(limit.toInt() - 24 + 1))
        assertEquals(ImportResult.INVALID, import(over, importer = importer(limit = limit)))
        assertFalse(over.exists())
        assertTrue(OriginalImporter.VIDEO_MAX_BYTES < 2_000_000_000L, "SR-FILE-12: every video of the phone stays below the scan threshold")
        assertTrue(OriginalImporter.VIDEO_MAX_BYTES >= 500_000_000L, "the safety limit of the recording must fit")
    }

    @Test
    fun `EVM-110 AC1 SEC-110-05 only the video of the camera cache is taken - a picture does not pass the video path and a video does`() {
        val photo = video(name = CAMERA_PHOTO, bytes = mp4())
        assertEquals(ImportResult.INVALID, import(photo))
        assertTrue(photo.exists(), "a source that is not ours is not touched")
        val clip = video()
        assertEquals(ImportResult.INVALID, importer().import(ASSET, uri(clip), MediaKind.PHOTO))
        assertTrue(clip.exists())
        assertFalse(target().exists())
        assertFalse(files.originalFile(ASSET).exists())
    }

    @Test
    fun `EVM-110 AC1 SEC-110-05 the source URI must be a plain file URI of the camera folder - no dots, no other folder, no query, no`() {
        val source = video()
        val good = uri(source)
        val elsewhere = File(root, "cache/Camera2/$CAMERA_VIDEO").apply { parentFile.mkdirs() }.also { it.writeBytes(mp4()) }
        val bad =
            listOf(
                good.replace("/Camera/", "/Camera/../Camera/"),
                good.replace("/Camera/", "/Camera/%2e%2e/Camera/"),
                good.replace("/Camera/", "/Camera/./"),
                "content://media/external/video/media/1",
                "$good?x=1",
                "$good#frag",
                good.replace("file:///", "file://host/"),
                uri(elsewhere),
                "file:///data/user/0/x/$CAMERA_VIDEO",
                "not a uri",
            )
        for (candidate in bad) {
            assertEquals(ImportResult.INVALID, importer().import(ASSET, candidate, MediaKind.VIDEO), candidate)
        }
        assertTrue(source.exists())
        assertTrue(elsewhere.exists())
        assertFalse(target().exists())
        assertEquals(ImportResult.INVALID, import(source, assetId = "../../token"))
    }

    @Test
    fun `EVM-110 AC1 SEC-110-05 a link in place of the file or the folder of the camera is refused`() {
        val real = File(root, "real.mp4").also { it.writeBytes(mp4()) }
        val link = File(camera, CAMERA_VIDEO).apply { parentFile.mkdirs() }
        try {
            Files.createSymbolicLink(link.toPath(), real.toPath())
        } catch (error: IOException) {
            assumeTrue(false, "symbolic links are not available here")
        }
        assertEquals(ImportResult.INVALID, import(link))
        assertTrue(real.exists())
        assertFalse(target().exists())
        link.delete()
        camera.deleteRecursively()
        val realFolder = File(root, "real-camera").apply { mkdirs() }
        File(realFolder, CAMERA_VIDEO).writeBytes(mp4())
        Files.createSymbolicLink(camera.toPath(), realFolder.toPath())
        assertEquals(ImportResult.INVALID, import(File(camera, CAMERA_VIDEO)))
        assertTrue(File(realFolder, CAMERA_VIDEO).exists())
    }

    @Test
    fun `EVM-110 AC1 SEC-110-07 files on different file stores are never moved - the plain move would copy`() {
        val source = video()
        assertEquals(ImportResult.IO_ERROR, import(source, importer = importer(sameStore = { _, _ -> false })))
        assertTrue(moves.isEmpty(), "no move, so no silent copy")
        assertFalse(target().exists())
        assertFalse(source.exists(), "the recording is dropped like every failed import (the user records again)")
        assertEquals(
            emptyList<String>(),
            files.originalsDirectory
                .list()
                ?.toList()
                .orEmpty(),
        )
    }

    @Test
    fun `EVM-110 AC1 SEC-110-07 an existing original is never replaced - found first, or by the race at the move itself`() {
        files.originalsDirectory.mkdirs()
        val existing = byteArrayOf(9, 9, 9)
        target().writeBytes(existing)
        assertEquals(ImportResult.EXISTS, import(video()))
        assertArrayEquals(existing, target().readBytes())
        assertTrue(moves.isEmpty())
        // a picture original of the same asset also counts: the asset has one original
        target().delete()
        files.originalFile(ASSET).writeBytes(existing)
        assertEquals(ImportResult.EXISTS, import(video()))
        assertArrayEquals(existing, files.originalFile(ASSET).readBytes())
        // the race: the target appears between the look and the move
        files.originalFile(ASSET).delete()
        val racing =
            importer(move = { _, to ->
                to.toFile().writeBytes(existing)
                throw FileAlreadyExistsException(to.toString())
            })
        assertEquals(ImportResult.EXISTS, import(video(), importer = racing))
        assertArrayEquals(existing, target().readBytes(), "the file that appeared is somebody's original and stays")
    }

    @Test
    fun `EVM-110 AC1 a failing move leaves no target and no temporary file, a missing source is reported, nothing is half done`() {
        assertEquals(ImportResult.IO_ERROR, import(video(), importer = importer(move = { _, _ -> throw IOException("synthetic") })))
        assertFalse(target().exists())
        assertEquals(ImportResult.SOURCE_MISSING, import(File(camera, CAMERA_VIDEO)))
        assertEquals(
            emptyList<String>(),
            files.originalsDirectory
                .list()
                ?.toList()
                .orEmpty(),
        )
    }

    @Test
    fun `EVM-110 AC3 AC6 the wipe marker stops the import - before the checks and in the window before the move - and nothing becomes`() {
        wipe = true
        val first = video()
        assertEquals(ImportResult.WIPE_ACTIVE, import(first))
        assertFalse(first.exists())
        wipe = false
        val second = video()
        val late = importer(sameStore = { a, b -> (Files.getFileStore(a) == Files.getFileStore(b)).also { wipe = true } })
        assertEquals(ImportResult.WIPE_ACTIVE, import(second, importer = late))
        assertTrue(moves.isEmpty())
        assertFalse(target().exists())
        assertFalse(second.exists())
    }

    @Test
    fun `EVM-110 AC3 SEC-110-11 the sweep removes an old video of the camera cache and keeps a recording that may still be written`() {
        val old = video(name = CAMERA_VIDEO).also { it.setLastModified(clock - 16 * MINUTE) }
        val young = video(name = "aaaaaaaa-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4").also { it.setLastModified(clock - 14 * MINUTE) }
        val justNow = video(name = "bbbbbbbb-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4").also { it.setLastModified(clock) }
        // the caller asks for 10 minutes (the app's sweep); a video never goes before the floor of the engine
        assertEquals(1, importer().sweep(emptySet(), 10 * MINUTE))
        assertFalse(old.exists())
        assertTrue(young.exists())
        assertTrue(justNow.exists())
        assertTrue(OriginalImporter.VIDEO_MIN_AGE_MS > 5 * MINUTE, "longer than the longest recording")
        assertEquals(15 * MINUTE, OriginalImporter.VIDEO_MIN_AGE_MS)
    }

    @Test
    fun `EVM-110 AC3 SEC-110-11 the sweep still takes pictures by the age asked, leaves folders and foreign names, and removes`() {
        val oldPhoto = video(name = CAMERA_PHOTO, bytes = byteArrayOf(1)).also { it.setLastModified(clock - 11 * MINUTE) }
        val foreign = video(name = "recording.mp4").also { it.setLastModified(clock - 60 * MINUTE) }
        val folder = File(camera, "3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6c.mp4").apply { mkdirs() }
        files.originalsDirectory.mkdirs()
        val known =
            files.videoOriginalFile(ASSET).also {
                it.writeBytes(mp4())
                it.setLastModified(clock - 60 * MINUTE)
            }
        val other = "0193a000-0000-7000-8000-000000000002"
        val unknown =
            files.videoOriginalFile(other).also {
                it.writeBytes(mp4())
                it.setLastModified(clock - 60 * MINUTE)
            }
        val unknownYoung =
            files.videoOriginalFile("0193a000-0000-7000-8000-000000000003").also {
                it.writeBytes(mp4())
                it.setLastModified(clock)
            }
        assertEquals(2, importer().sweep(setOf(ASSET), 10 * MINUTE))
        assertFalse(oldPhoto.exists())
        assertTrue(foreign.exists())
        assertTrue(folder.isDirectory)
        assertTrue(known.exists())
        assertFalse(unknown.exists())
        assertTrue(unknownYoung.exists(), "an import that is still being registered stays")
    }

    @Test
    fun `EVM-110 AC3 AC6 the sign-out cleaning removes the videos of the camera cache at once, whatever their age`() {
        val recording = video().also { it.setLastModified(clock) }
        assertTrue(importer().clearLeftovers())
        assertFalse(recording.exists())
        val again = video()
        assertTrue(importer().clearLeftoversIfSignedOut { false })
        assertTrue(again.exists(), "a running session keeps its files")
        assertTrue(importer().clearLeftoversIfSignedOut { true })
        assertFalse(again.exists())
    }

    @Test
    fun `EVM-110 AC6 the removal of an original, the end of a job and the wipe take the video original too`() {
        import(video())
        val jobs = JobFileStore(files)
        jobs.arm(JobFileData(ASSET, "0193a000-0000-7000-8000-0000000000d1", 40, "u", "d", "video/mp4", "a".repeat(64), null))
        jobs.delete(ASSET)
        assertFalse(target().exists())
        assertFalse(files.jobFile(ASSET).exists())
        import(video())
        val lifecycle =
            JobLifecycle(
                files,
                JobIdRegistry(files.jobIdsFile, 1000, 5),
                NoSystem,
                pl.eviacharge.upload.runner
                    .RunningJobs(),
            )
        assertTrue(lifecycle.cancel(ASSET, deleteOriginal = true))
        assertFalse(target().exists())
        import(video())
        val marker = WipeMarker(files.wipeMarkerFile)
        val chain = WipeChain(files, marker, { }, { }, { }, { }, JobIdRegistry(files.jobIdsFile, 1000, 5))
        assertTrue(chain.run())
        assertFalse(target().exists())
        assertFalse(files.originalsDirectory.exists())
    }
}

private object NoSystem : pl.eviacharge.upload.schedule.SystemJobs {
    override fun isPending(id: Int) = false

    override fun schedule(request: pl.eviacharge.upload.schedule.JobRequest) = pl.eviacharge.upload.schedule.ScheduleResult.SCHEDULED

    override fun cancel(id: Int) = Unit
}
