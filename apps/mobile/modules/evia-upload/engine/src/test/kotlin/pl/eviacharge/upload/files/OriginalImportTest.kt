package pl.eviacharge.upload.files

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.IOException
import java.nio.file.Files

private const val ASSET = "0193a000-0000-7000-8000-000000000001"
private const val CAMERA_NAME = "3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.jpg"
private const val OLD = 1_000_000_000_000L
private val JPEG = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2, 3, 4, 5, 6)

/** EVM-108 AC1 and AC4: the durable import of a captured picture and every refusal of the security review (pkt 11-13). */
class OriginalImportTest {
    @TempDir
    lateinit var root: File

    private var wipe = false
    private var freeSpace = Long.MAX_VALUE
    private var clock = OLD + 3_600_000

    private val files get() = UploadFiles(File(root, "upload"), File(root, "cache/Camera"))
    private val camera get() = files.cameraDirectory

    private fun importer(copy: (java.io.InputStream, java.io.OutputStream) -> Unit = { input, output -> input.copyTo(output) }) =
        OriginalImporter(files, { wipe }, { freeSpace }, { clock }, copy)

    private fun picture(
        name: String = CAMERA_NAME,
        bytes: ByteArray = JPEG,
    ): File = File(camera, name).apply { parentFile.mkdirs() }.also { it.writeBytes(bytes) }

    private fun uri(file: File) =
        file
            .toURI()
            .toString()
            .replace("file:/", "file:///")
            .replace("file://///", "file:///")

    private fun import(
        source: String,
        assetId: String = ASSET,
    ) = importer().import(assetId, source)

    private fun leftovers(): List<String> =
        File(root, "upload")
            .walkTopDown()
            .filter { it.isFile }
            .map { it.name }
            .toList()

    @Test
    fun `EVM-108 AC1 a camera picture becomes the durable original with the same bytes and the source goes`() {
        val source = picture()
        assertEquals(ImportResult.OK, import(uri(source)))
        assertEquals(JPEG.toList(), files.originalFile(ASSET).readBytes().toList())
        assertFalse(source.exists())
        assertEquals(listOf(ASSET), leftovers())
    }

    @Test
    fun `EVM-108 AC1 the wire codes are the short words of the bridge, never a message`() {
        assertEquals(
            listOf("ok", "invalid", "source_missing", "no_space", "io_error", "wipe_active", "exists"),
            ImportResult.entries.map { it.wire },
        )
    }

    @Test
    fun `EVM-108 AC1 a path with dot dot, encoded or not, is refused and nothing outside is touched`() {
        val secret = File(root, "cache/secret.jpg").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        picture()
        for (text in listOf(
            "file:///${camera.absolutePath}/../secret.jpg",
            "file:///${camera.absolutePath}/%2e%2e/secret.jpg",
            "file:///${camera.absolutePath}/%2E%2E/$CAMERA_NAME",
        )) {
            assertEquals(ImportResult.INVALID, import(text.replace("\\", "/").replace(":////", ":///")), text)
        }
        assertTrue(secret.exists())
        assertFalse(files.originalFile(ASSET).exists())
    }

    @Test
    fun `EVM-108 AC1 only a file URI is accepted - content, http, relative, with host, query or fragment are refused`() {
        val source = picture()
        val path = source.absolutePath.replace("\\", "/").let { if (it.startsWith("/")) it else "/$it" }
        listOf(
            "content://media/external/images/1",
            "https://example.invalid/$CAMERA_NAME",
            "file:relative/$CAMERA_NAME",
            "file://host$path",
            "file://$path?x=1",
            "file://$path#x",
            "file://$path%00",
            "not a uri at all",
            "",
            path,
        ).forEach { assertEquals(ImportResult.INVALID, import(it), it) }
        assertTrue(source.exists(), "a refused URI never deletes anything")
    }

    @Test
    fun `EVM-108 AC1 an absolute path outside the capture folder and the folders Camera2 and CameraX are refused and kept`() {
        val foreign = File(root, "cache/other/$CAMERA_NAME").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        val sibling = File(root, "cache/Camera2/$CAMERA_NAME").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        val sibling2 = File(root, "cache/CameraX/$CAMERA_NAME").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        val nested = File(camera, "sub/$CAMERA_NAME").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        listOf(foreign, sibling, sibling2, nested).forEach {
            assertEquals(ImportResult.INVALID, import(uri(it)), it.path)
            assertTrue(it.exists())
        }
    }

    @Test
    fun `EVM-108 AC1 a name that is not the name of the camera is refused`() {
        listOf(
            "photo.jpg",
            "../x.jpg",
            "3F2B9C1E-5D4A-4E8F-9A7B-1C2D3E4F5A6B.jpg",
            "3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.png",
            ".jpg",
        ).forEach { name ->
            val file = File(camera, name.substringAfterLast('/')).apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
            assertEquals(ImportResult.INVALID, import(uri(file)), name)
            assertTrue(file.exists())
        }
    }

    @Test
    fun `EVM-108 AC1 a link to the database file is refused, the link goes and the target stays`() {
        val database = File(root, "databases/evia.db").apply { parentFile.mkdirs() }.also { it.writeBytes(JPEG) }
        camera.mkdirs()
        val link = File(camera, CAMERA_NAME)
        assumeTrue(tryLink(link, database), "symbolic links are not available here")
        assertEquals(ImportResult.INVALID, import(uri(link)))
        assertTrue(database.exists())
        assertFalse(Files.exists(link.toPath(), java.nio.file.LinkOption.NOFOLLOW_LINKS))
        assertFalse(files.originalFile(ASSET).exists())
    }

    @Test
    fun `EVM-108 AC1 a capture folder that is a link is refused and its target is not touched`() {
        val real = File(root, "cache/real").apply { mkdirs() }
        File(real, CAMERA_NAME).writeBytes(JPEG)
        camera.parentFile.mkdirs()
        assumeTrue(tryLink(camera, real), "symbolic links are not available here")
        assertEquals(ImportResult.INVALID, import(uri(File(camera, CAMERA_NAME))))
        assertTrue(File(real, CAMERA_NAME).exists())
        assertFalse(files.originalFile(ASSET).exists())
    }

    @Test
    fun `EVM-108 AC1 a directory in place of the file is refused`() {
        val directory = File(camera, CAMERA_NAME).apply { mkdirs() }
        File(directory, "inner").writeBytes(JPEG)
        assertEquals(ImportResult.INVALID, import(uri(directory)))
        assertTrue(File(directory, "inner").exists())
    }

    @Test
    fun `EVM-108 AC1 an empty file, a too large file and a file that is not a JPEG are refused and removed`() {
        val empty = picture(bytes = ByteArray(0))
        assertEquals(ImportResult.INVALID, import(uri(empty)))
        assertFalse(empty.exists())
        val png = picture(bytes = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 1, 2, 3))
        assertEquals(ImportResult.INVALID, import(uri(png)))
        assertFalse(png.exists())
        val short = picture(bytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte()))
        assertEquals(ImportResult.INVALID, import(uri(short)))
        assertFalse(short.exists())
        val large = picture()
        java.io.RandomAccessFile(large, "rw").use {
            it.write(JPEG)
            it.setLength(OriginalImporter.MAX_BYTES + 1)
        }
        assertEquals(ImportResult.INVALID, import(uri(large)))
        assertFalse(large.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `EVM-108 AC1 a file of exactly the limit is imported`() {
        val source = picture()
        java.io.RandomAccessFile(source, "rw").use {
            it.write(JPEG)
            it.setLength(OriginalImporter.MAX_BYTES)
        }
        assertEquals(ImportResult.OK, import(uri(source)))
        assertEquals(OriginalImporter.MAX_BYTES, files.originalFile(ASSET).length())
    }

    @Test
    fun `EVM-108 AC1 a bad asset identifier is refused before any path is built`() {
        val source = picture()
        listOf("", "../x", "0193A000-0000-7000-8000-000000000001", "not-a-uuid", "$ASSET/..").forEach {
            assertEquals(ImportResult.INVALID, importer().import(it, uri(source)), it)
        }
        assertTrue(source.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `EVM-108 AC1 a missing source is reported as such and writes nothing`() {
        camera.mkdirs()
        assertEquals(ImportResult.SOURCE_MISSING, import(uri(File(camera, CAMERA_NAME))))
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `EVM-108 AC1 an existing original is never overwritten, a second import of the same asset fails`() {
        val first = picture()
        assertEquals(ImportResult.OK, import(uri(first)))
        val other = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 9, 9, 9)
        val second = picture(name = "4f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.jpg", bytes = other)
        assertEquals(ImportResult.EXISTS, import(uri(second)))
        assertEquals(JPEG.toList(), files.originalFile(ASSET).readBytes().toList())
        assertEquals(listOf(ASSET), leftovers())
    }

    @Test
    fun `EVM-108 AC1 an original that appears while the copy runs is never overwritten - the race between the look and the placing`() {
        val source = picture()
        val other = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 7, 7, 7)
        val result =
            importer { input, output ->
                input.copyTo(output)
                // somebody creates the original after the import looked and before it places its own
                files.originalFile(ASSET).apply { parentFile.mkdirs() }.writeBytes(other)
            }.import(ASSET, uri(source))
        assertEquals(ImportResult.EXISTS, result)
        assertEquals(other.toList(), files.originalFile(ASSET).readBytes().toList())
        assertEquals(listOf(ASSET), leftovers())
        assertFalse(source.exists())
    }

    @Test
    fun `EVM-108 AC1 a file system without hard links falls back to the move that does not replace either`() {
        val noLinks = { _: java.nio.file.Path, _: java.nio.file.Path -> throw UnsupportedOperationException("no links") }
        val ioFailure = { _: java.nio.file.Path, _: java.nio.file.Path -> throw IOException("link refused") }
        for (link in listOf(noLinks, ioFailure)) {
            val own = OriginalImporter(files, { wipe }, { freeSpace }, { clock }, { input, output -> input.copyTo(output) }, link)
            assertEquals(ImportResult.OK, own.import(ASSET, uri(picture())))
            assertEquals(JPEG.toList(), files.originalFile(ASSET).readBytes().toList())
            assertEquals(listOf(ASSET), leftovers())
            files.originalFile(ASSET).delete()
        }
        val other = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 8)
        val racing =
            OriginalImporter(files, { wipe }, { freeSpace }, { clock }, { input, output ->
                input.copyTo(output)
                files.originalFile(ASSET).writeBytes(other)
            }, noLinks)
        assertEquals(ImportResult.EXISTS, racing.import(ASSET, uri(picture())))
        assertEquals(other.toList(), files.originalFile(ASSET).readBytes().toList())
        assertEquals(listOf(ASSET), leftovers())
    }

    @Test
    fun `EVM-108 AC1 clearing after a sign-out runs only for a phone that is signed out`() {
        aged(File(camera, CAMERA_NAME))
        assertTrue(importer().clearLeftoversIfSignedOut { false })
        assertTrue(File(camera, CAMERA_NAME).exists(), "a running session keeps its pictures")
        assertTrue(importer().clearLeftoversIfSignedOut { true })
        assertFalse(camera.exists())
    }

    @Test
    fun `EVM-108 AC1 a set wipe marker refuses the import and removes the source`() {
        val source = picture()
        wipe = true
        assertEquals(ImportResult.WIPE_ACTIVE, import(uri(source)))
        assertFalse(source.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `EVM-108 AC1 a wipe that starts while the copy runs leaves nothing`() {
        val source = picture()
        val result = importer { input, output -> input.copyTo(output).also { wipe = true } }.import(ASSET, uri(source))
        assertEquals(ImportResult.WIPE_ACTIVE, result)
        assertFalse(source.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `EVM-108 AC4 not enough free space writes nothing and no partial file stays`() {
        val source = picture()
        freeSpace = JPEG.size + OriginalImporter.RESERVE_BYTES - 1
        assertEquals(ImportResult.NO_SPACE, import(uri(source)))
        assertEquals(emptyList<String>(), leftovers())
        freeSpace = JPEG.size + OriginalImporter.RESERVE_BYTES
        val again = picture()
        assertEquals(ImportResult.OK, import(uri(again)))
    }

    @Test
    fun `EVM-108 AC4 a write that fails half way leaves neither the target nor the temporary file`() {
        val source = picture()
        val result =
            importer { _, output ->
                output.write(byteArrayOf(1, 2, 3))
                throw IOException("disk full")
            }.import(ASSET, uri(source))
        assertEquals(ImportResult.IO_ERROR, result)
        assertFalse(files.originalFile(ASSET).exists())
        assertEquals(emptyList<String>(), leftovers())
        assertEquals("ok", importer().import(ASSET, uri(picture())).wire, "the same asset can be imported after the failure")
    }

    @Test
    fun `EVM-108 AC1 a temporary file of an earlier killed import does not block a new import`() {
        val stale =
            File(files.originalsDirectory, CaptureCache.temporaryName(ASSET))
                .apply {
                    parentFile.mkdirs()
                }.also { it.writeBytes(byteArrayOf(7)) }
        assertEquals(ImportResult.OK, import(uri(picture())))
        assertFalse(stale.exists())
        assertEquals(JPEG.toList(), files.originalFile(ASSET).readBytes().toList())
    }

    // ---- sweepOriginals (pkt 12) ----

    private fun aged(
        file: File,
        modified: Long = OLD,
    ) = file.also { it.parentFile.mkdirs() }.also { if (!it.exists()) it.writeBytes(JPEG) }.also { it.setLastModified(modified) }

    private fun asset(n: Int) = "0193a000-0000-7000-8000-%012d".format(n)

    @Test
    fun `EVM-108 AC1 the sweep removes unknown originals, import leftovers and old camera files, never a kept original`() {
        val kept = aged(files.originalFile(asset(1)))
        val unknown = aged(files.originalFile(asset(2)))
        val temp = aged(File(files.originalsDirectory, CaptureCache.temporaryName(asset(3))))
        val cameraOld = aged(File(camera, CAMERA_NAME))
        val foreignName = aged(File(files.originalsDirectory, "notes.txt"))
        assertEquals(3, importer().sweep(setOf(asset(1)), 600_000))
        assertTrue(kept.exists())
        assertTrue(foreignName.exists(), "only what the module itself writes is swept")
        listOf(unknown, temp, cameraOld).forEach { assertFalse(it.exists(), it.name) }
    }

    @Test
    fun `EVM-108 AC1 the sweep keeps what is younger than the threshold - a picture being saved is safe`() {
        val young = aged(files.originalFile(asset(2)), clock - 1_000)
        val youngCamera = aged(File(camera, CAMERA_NAME), clock - 1_000)
        assertEquals(0, importer().sweep(emptySet(), 600_000))
        assertTrue(young.exists())
        assertTrue(youngCamera.exists())
    }

    @Test
    fun `EVM-108 AC1 the sweep compares identifiers in lower case and does not recurse`() {
        val kept = aged(files.originalFile(asset(1)))
        val deep = aged(File(files.originalsDirectory, "sub/${asset(5)}"))
        val deepCamera = aged(File(camera, "sub/$CAMERA_NAME"))
        assertEquals(0, importer().sweep(setOf(asset(1).uppercase()), 600_000))
        assertTrue(kept.exists())
        assertTrue(deep.exists())
        assertTrue(deepCamera.exists())
    }

    @Test
    fun `EVM-108 AC1 the sweep never follows a link out of the folders`() {
        val outside = File(root, "outside").apply { mkdirs() }
        val victim = aged(File(outside, "victim.jpg"))
        files.originalsDirectory.mkdirs()
        val link = File(files.originalsDirectory, asset(9))
        assumeTrue(tryLink(link, victim), "symbolic links are not available here")
        assertEquals(0, importer().sweep(emptySet(), 0))
        assertTrue(victim.exists())
        // a link in place of the capture folder is not entered either
        val real = File(root, "real").apply { mkdirs() }
        aged(File(real, CAMERA_NAME))
        camera.parentFile.mkdirs()
        assumeTrue(tryLink(camera, real), "symbolic links are not available here")
        assertEquals(0, importer().sweep(emptySet(), 0))
        assertTrue(File(real, CAMERA_NAME).exists())
    }

    @Test
    fun `EVM-108 AC1 the sweep of missing folders is nothing to do`() {
        assertEquals(0, importer().sweep(emptySet(), 0))
    }

    // ---- cleaning at sign-out and wipe (pkt 13) ----

    @Test
    fun `EVM-108 AC1 clearing leftovers removes the capture cache and the temporary files but keeps the originals`() {
        val original = aged(files.originalFile(asset(1)))
        val temp = aged(File(files.originalsDirectory, CaptureCache.temporaryName(asset(2))))
        aged(File(camera, CAMERA_NAME))
        aged(File(camera, "sub/$CAMERA_NAME"))
        assertTrue(importer().clearLeftovers())
        assertFalse(camera.exists())
        assertFalse(temp.exists())
        assertTrue(original.exists())
        assertTrue(importer().clearLeftovers(), "idempotent")
    }

    @Test
    fun `EVM-108 AC1 clearing a link in place of the capture folder removes the link only`() {
        val real = File(root, "real").apply { mkdirs() }
        val inside = aged(File(real, CAMERA_NAME))
        camera.parentFile.mkdirs()
        assumeTrue(tryLink(camera, real), "symbolic links are not available here")
        assertTrue(CaptureCache.deleteTree(camera))
        assertFalse(Files.exists(camera.toPath(), java.nio.file.LinkOption.NOFOLLOW_LINKS))
        assertTrue(inside.exists())
    }

    @Test
    fun `EVM-108 AC1 the cleaning of the phone removes a picture left in the camera cache and says false while one stays`() {
        val files = files
        val leftover = aged(File(camera, CAMERA_NAME))
        val marker = WipeMarker(files.wipeMarkerFile)
        val ids = JobIdRegistry(files.jobIdsFile, 1000, 5)
        val chain = WipeChain(files, marker, { }, { }, { }, { }, ids)
        assertTrue(chain.run())
        assertFalse(leftover.exists())
        assertFalse(camera.exists())
    }

    @Test
    fun `EVM-108 AC1 when a file of the camera cache cannot be removed the cleaning says false - fail closed`() {
        aged(File(camera, CAMERA_NAME))
        assertFalse(CaptureCache.deleteTree(camera) { throw IOException("locked") })
        assertTrue(camera.exists())
        assertTrue(CaptureCache.deleteTree(camera))
    }

    private fun tryLink(
        link: File,
        target: File,
    ): Boolean =
        try {
            Files.createSymbolicLink(link.toPath(), target.toPath())
            true
        } catch (error: IOException) {
            false
        } catch (error: UnsupportedOperationException) {
            false
        }
}
