package pl.eviacharge.upload.files

import pl.eviacharge.upload.StopCheck
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.net.URISyntaxException
import java.nio.channels.Channels
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardOpenOption

/** What the import of a captured photo answered; [wire] is the only thing that crosses to JavaScript (never a path, never a message). */
enum class ImportResult(
    val wire: String,
) {
    /** The original is durable under `originals/<assetId>` and the source is gone. */
    OK("ok"),

    /** The source or the identifier is not what it must be (outside the capture folder, a link, a foreign type, empty, too large, a bad name). */
    INVALID("invalid"),

    /** The source file is not there (anymore). */
    SOURCE_MISSING("source_missing"),

    /** Not enough free space for the copy and the reserve; nothing was written. */
    NO_SPACE("no_space"),

    /** The copy failed half way; neither the target nor a temporary file stayed. */
    IO_ERROR("io_error"),

    /** The device wipe is in progress: nothing is imported and the source is removed. */
    WIPE_ACTIVE("wipe_active"),

    /** The original of this asset exists already; it is never overwritten. */
    EXISTS("exists"),
}

/** The files the camera left behind and the leftovers of an interrupted import: where they are and how they are removed. */
object CaptureCache {
    /** `<random UUID>.jpg`: how `expo-camera` names a picture in `cacheDir/Camera/`. */
    val CAMERA_FILE_NAME = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$")

    /** The name of the temporary copy while an import runs; it ends with [AtomicFiles.TEMP_SUFFIX], so the wipe and the sweep find it. */
    fun temporaryName(assetId: String) = "$assetId.import${AtomicFiles.TEMP_SUFFIX}"

    /** Removes [directory] with everything in it WITHOUT following links; `false` when something stayed. A missing directory is done. */
    fun deleteTree(
        directory: File,
        delete: (Path) -> Unit = { Files.deleteIfExists(it) },
    ): Boolean {
        val path = directory.toPath()
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return true
        return try {
            if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                Files.newDirectoryStream(path).use { children -> children.forEach { if (!deleteTree(it.toFile(), delete)) return false } }
            }
            delete(path)
            true
        } catch (error: IOException) {
            false
        }
    }

    /** A regular file (not a link, not a directory) directly in [directory], in the order of the system; empty when [directory] is a link or missing. */
    fun regularFiles(directory: File): List<File> {
        val path = directory.toPath()
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) return emptyList()
        return try {
            Files.newDirectoryStream(path).use { children ->
                children.filter { Files.isRegularFile(it, LinkOption.NOFOLLOW_LINKS) }.map { it.toFile() }
            }
        } catch (error: IOException) {
            emptyList()
        }
    }
}

/**
 * The durable import of a picture the camera wrote (EVM-108 AC1): `expo-camera` puts it in `cacheDir/Camera/<uuid>.jpg`, a place the system
 * may empty; here it is copied to the private folder of the originals (`originals/<assetId>`) with `fsync`, and only then the source goes.
 * Every check is by this code, never by the caller (CWE-22, CWE-59): `file:` URI only, the file directly in the capture folder, the
 * name of the camera, a regular file opened without following links, a JPEG of 1..[MAX_BYTES] bytes, the identifier a UUID, the target new.
 * One lock covers the import, the sweep and the cleaning: the sweep never removes a file the import is writing.
 * The answer is a code; no path or exception text leaves this class.
 */
class OriginalImporter(
    private val files: UploadFiles,
    private val marker: StopCheck,
    private val freeBytes: (File) -> Long = { it.usableSpace },
    private val now: () -> Long = System::currentTimeMillis,
    private val copy: (InputStream, OutputStream) -> Unit = { input, output -> input.copyTo(output) },
    private val link: (Path, Path) -> Unit = { target, existing -> Files.createLink(target, existing) },
) {
    @Synchronized
    fun import(
        assetId: String,
        sourceUri: String,
    ): ImportResult {
        val source = confinedSource(sourceUri)
        val target = confinedTarget(assetId)
        if (source == null || target == null) return ImportResult.INVALID
        if (marker.isStopped()) return rejected(source, ImportResult.WIPE_ACTIVE)
        val sourcePath = source.toPath()
        if (!Files.exists(sourcePath, LinkOption.NOFOLLOW_LINKS)) return ImportResult.SOURCE_MISSING
        if (Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)) return rejected(source, ImportResult.EXISTS)
        if (!Files.isRegularFile(sourcePath, LinkOption.NOFOLLOW_LINKS)) return rejected(source, ImportResult.INVALID)
        return try {
            Files.newByteChannel(sourcePath, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { channel ->
                val size = channel.size()
                when {
                    size !in 1..MAX_BYTES -> rejected(source, ImportResult.INVALID)
                    else -> store(source, target, assetId, size, Channels.newInputStream(channel))
                }
            }
        } catch (error: NoSuchFileException) {
            ImportResult.SOURCE_MISSING
        } catch (error: IOException) {
            rejected(source, ImportResult.INVALID)
        }
    }

    private fun store(
        source: File,
        target: File,
        assetId: String,
        size: Long,
        input: InputStream,
    ): ImportResult {
        val directory = target.parentFile ?: return rejected(source, ImportResult.IO_ERROR)
        val temp = File(directory, CaptureCache.temporaryName(assetId))
        return try {
            Files.createDirectories(directory.toPath())
            if (freeBytes(directory) < size + RESERVE_BYTES) return rejected(source, ImportResult.NO_SPACE)
            val head = readHead(input)
            if (!head.contentEquals(JPEG_MAGIC)) return rejected(source, ImportResult.INVALID)
            Files.deleteIfExists(temp.toPath())
            FileOutputStream(temp).use { stream ->
                stream.write(head)
                copy(input, stream)
                stream.flush()
                stream.fd.sync()
            }
            // a wipe may have started while the copy ran: the marker is read again before the file becomes the original
            if (marker.isStopped()) return rejected(source, ImportResult.WIPE_ACTIVE, temp)
            placeWithoutReplacing(temp.toPath(), target.toPath())
            // the original is in place: nothing below may undo it (a source or a temporary name that cannot be removed is swept later)
            runCatching { Files.deleteIfExists(temp.toPath()) }
            runCatching { Files.deleteIfExists(source.toPath()) }
            ImportResult.OK
        } catch (error: FileAlreadyExistsException) {
            // the target appeared after the first look (a race): it is somebody's original and stays as it is
            rejected(source, ImportResult.EXISTS, temp)
        } catch (error: IOException) {
            rejected(source, ImportResult.IO_ERROR, temp)
        }
    }

    /**
     * The temporary file becomes the original under its name WITHOUT ever replacing a file that is already there (security 11: `CREATE_NEW`
     * semantics). A hard link is created by the system in one step and fails with [FileAlreadyExistsException] when the name exists, even if it
     * was created a moment ago; a rename would replace it silently. When the file system has no hard links, the move without replacing is used
     * (it fails on an existing target too; its own check is the only window left).
     */
    private fun placeWithoutReplacing(
        temp: Path,
        target: Path,
    ) {
        try {
            link(target, temp)
        } catch (error: FileAlreadyExistsException) {
            throw error
        } catch (error: UnsupportedOperationException) {
            Files.move(temp, target)
        } catch (error: IOException) {
            Files.move(temp, target)
        }
    }

    private fun readHead(input: InputStream): ByteArray {
        val head = ByteArray(JPEG_MAGIC.size)
        var read = 0
        while (read < head.size) {
            val count = input.read(head, read, head.size - read)
            if (count < 0) break
            read += count
        }
        return head.copyOf(read)
    }

    /** The import failed after the source was recognised as ours: nothing partial stays and the source goes (the user is told to take the picture again). */
    private fun rejected(
        source: File,
        result: ImportResult,
        vararg leftovers: File,
    ): ImportResult {
        leftovers.forEach { runCatching { Files.deleteIfExists(it.toPath()) } }
        runCatching { Files.deleteIfExists(source.toPath()) }
        return result
    }

    /** The file of the camera directly in the capture folder, or `null`: every rule of the security review, pkt 11. */
    private fun confinedSource(uriText: String): File? {
        val uri =
            try {
                URI(uriText)
            } catch (error: URISyntaxException) {
                return null
            }
        val path = uri.path
        if (uri.scheme != "file" || uri.host != null || uri.rawQuery != null || uri.rawFragment != null || path == null) return null
        if (!path.startsWith("/") || path.split('/').any { it == ".." || it == "." }) return null
        val file = File(path)
        if (!CaptureCache.CAMERA_FILE_NAME.matches(file.name)) return null
        val directory = files.cameraDirectory
        if (Files.isSymbolicLink(directory.toPath())) return null
        val parent = file.parentFile ?: return null
        return if (sameDirectory(parent, directory)) file else null
    }

    private fun sameDirectory(
        first: File,
        second: File,
    ): Boolean =
        try {
            first.canonicalFile == second.canonicalFile
        } catch (error: IOException) {
            false
        }

    private fun confinedTarget(assetId: String): File? =
        try {
            files.originalFile(assetId)
        } catch (error: InvalidIdentifierException) {
            null
        }

    /**
     * The sweep: originals nobody knows (not in [keepAssetIds], older than [olderThanMs]), leftovers of imports and pictures the camera
     * left in its cache. Regular files directly in the two folders only, no recursion, no links. Returns how many files went.
     */
    @Synchronized
    fun sweep(
        keepAssetIds: Set<String>,
        olderThanMs: Long,
    ): Int {
        val cutoff = now() - olderThanMs
        val keep = keepAssetIds.map { it.lowercase() }.toSet()
        val doomed =
            CaptureCache.regularFiles(files.originalsDirectory).filter { file ->
                val name = file.name
                val unknownOriginal = UploadFiles.isAssetId(name) && name !in keep
                (unknownOriginal || name.endsWith(AtomicFiles.TEMP_SUFFIX)) && file.lastModified() <= cutoff
            } +
                CaptureCache.regularFiles(files.cameraDirectory).filter {
                    CaptureCache.CAMERA_FILE_NAME.matches(it.name) &&
                        it.lastModified() <= cutoff
                }
        return doomed.count { runCatching { Files.deleteIfExists(it.toPath()) }.getOrDefault(false) }
    }

    /**
     * The retry of the cleaning of a phone that is signed out (at the start of the app and when the network returns): the capture cache of a
     * session that has ended goes, a running session keeps its pictures. `true` when nothing stayed.
     */
    fun clearLeftoversIfSignedOut(signedOut: () -> Boolean): Boolean = if (signedOut()) clearLeftovers() else true

    /** Sign-out and the wipe: the capture cache and the temporary files of the import go at once. `false` when something stayed. */
    @Synchronized
    fun clearLeftovers(): Boolean {
        val temporary = CaptureCache.regularFiles(files.originalsDirectory).filter { it.name.endsWith(AtomicFiles.TEMP_SUFFIX) }
        val removed = temporary.map { runCatching { Files.deleteIfExists(it.toPath()) }.isSuccess }
        return CaptureCache.deleteTree(files.cameraDirectory) && removed.all { it }
    }

    companion object {
        /** SR-FILE-01: the limit of a photo. */
        const val MAX_BYTES = 50L * 1024 * 1024

        /** Free space that must remain after the copy (the database and the next picture need room). */
        const val RESERVE_BYTES = 16L * 1024 * 1024

        private val JPEG_MAGIC = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
    }
}
