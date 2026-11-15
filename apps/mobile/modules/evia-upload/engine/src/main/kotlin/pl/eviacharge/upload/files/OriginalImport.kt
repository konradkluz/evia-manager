package pl.eviacharge.upload.files

import pl.eviacharge.upload.StopCheck
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.net.URISyntaxException
import java.nio.ByteBuffer
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption
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

/** What the camera produced: decides the name pattern of the source, the checks of the content and the way the file becomes the original. */
enum class MediaKind {
    /** A JPEG: copied with `fsync` (EVM-108). */
    PHOTO,

    /** An MP4 (EVM-110): MOVED into place - never copied, never linked. */
    VIDEO,
    ;

    companion object {
        /** The kind the app names (`photo` / `video`: the mode of the camera); anything else is `null`, never guessed from a file name. */
        fun fromWire(value: String): MediaKind? = entries.firstOrNull { it.name.lowercase() == value }
    }
}

/** The files the camera left behind and the leftovers of an interrupted import: where they are and how they are removed. */
object CaptureCache {
    /** `<random UUID>.jpg`: how `expo-camera` names a picture in `cacheDir/Camera/`. */
    val CAMERA_FILE_NAME = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$")

    /** `<random UUID>.mp4`: how `expo-camera` names a video in `cacheDir/Camera/`. */
    val CAMERA_VIDEO_NAME = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]mp4$")

    fun matches(
        kind: MediaKind,
        name: String,
    ): Boolean = (if (kind == MediaKind.VIDEO) CAMERA_VIDEO_NAME else CAMERA_FILE_NAME).matches(name)

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
    /** A video is moved with a plain `Files.move`: without `REPLACE_EXISTING` (it refuses an existing target), without `ATOMIC_MOVE` (on Linux that replaces). */
    private val move: (Path, Path) -> Unit = { source, target -> Files.move(source, target) },
    /**
     * `Files.move` across volumes silently COPIES: a video is refused unless both sides are on the same volume. `false` = another volume, `null` = the
     * platform cannot tell (see [sameVolume]); then the move is the atomic one, which never copies.
     */
    private val sameStore: (Path, Path) -> Boolean? = { first, second -> sameVolume(first, second) },
    /** `rename` only: it fails across volumes (`AtomicMoveNotSupportedException`) and never copies; used when the volume of the two sides is unknown. */
    private val atomicMove: (Path, Path) -> Unit = { source, target -> Files.move(source, target, StandardCopyOption.ATOMIC_MOVE) },
    private val videoMaxBytes: Long = VIDEO_MAX_BYTES,
) {
    @Synchronized
    fun import(
        assetId: String,
        sourceUri: String,
        kind: MediaKind = MediaKind.PHOTO,
    ): ImportResult {
        val source = confinedSource(sourceUri, kind)
        val target = confinedTarget(assetId, kind)
        if (source == null || target == null) return ImportResult.INVALID
        if (marker.isStopped()) return rejected(source, ImportResult.WIPE_ACTIVE)
        val sourcePath = source.toPath()
        if (!Files.exists(sourcePath, LinkOption.NOFOLLOW_LINKS)) return ImportResult.SOURCE_MISSING
        if (anyOriginalExists(assetId)) return rejected(source, ImportResult.EXISTS)
        if (!Files.isRegularFile(sourcePath, LinkOption.NOFOLLOW_LINKS)) return rejected(source, ImportResult.INVALID)
        if (kind == MediaKind.VIDEO) return importVideo(source, target)
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

    private fun anyOriginalExists(assetId: String): Boolean =
        files.originalFiles(assetId).any { Files.exists(it.toPath(), LinkOption.NOFOLLOW_LINKS) }

    /**
     * A video (SEC-110-05/06/07): the file is opened without following links, its size is 1..[VIDEO_MAX_BYTES] and bytes 4..8 are `ftyp`
     * (the box size at 0 is sane); the content is fsynced where it is; then it MOVES to `originals/<assetId>.mp4` - no copy, no hard
     * link (SELinux forbids it), no replacing of an existing file, only within one file store. The marker is read again right before.
     */
    private fun importVideo(
        source: File,
        target: File,
    ): ImportResult {
        val sourcePath = source.toPath()
        return try {
            val verdict =
                FileChannel.open(sourcePath, StandardOpenOption.READ, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS).use { channel ->
                    val size = channel.size()
                    if (size !in 1..videoMaxBytes || !hasFtyp(channel)) return@use ImportResult.INVALID
                    // a file system that refuses `fsync` of this file must not lose the film: the move below keeps the bytes, the journal orders them
                    try {
                        channel.force(true)
                    } catch (error: IOException) {
                        // best effort
                    }
                    ImportResult.OK
                }
            if (verdict != ImportResult.OK) return rejected(source, verdict)
            val directory = target.parentFile ?: return rejected(source, ImportResult.IO_ERROR)
            Files.createDirectories(directory.toPath())
            val sameVolumeOrUnknown = sameStore(sourcePath, directory.toPath())
            if (sameVolumeOrUnknown == false) return rejected(source, ImportResult.IO_ERROR)
            if (marker.isStopped()) return rejected(source, ImportResult.WIPE_ACTIVE)
            if (sameVolumeOrUnknown == true) {
                move(sourcePath, target.toPath())
            } else {
                // the volume could not be read (some Android file systems have no mount entry for the app directories): the atomic rename never copies, and the
                // target was seen missing under the lock a moment ago, so nothing can be replaced
                if (Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)) return rejected(source, ImportResult.EXISTS)
                atomicMove(sourcePath, target.toPath())
            }
            ImportResult.OK
        } catch (error: FileAlreadyExistsException) {
            rejected(source, ImportResult.EXISTS)
        } catch (error: NoSuchFileException) {
            ImportResult.SOURCE_MISSING
        } catch (error: IOException) {
            rejected(source, ImportResult.IO_ERROR)
        }
    }

    private fun hasFtyp(channel: FileChannel): Boolean {
        val head = ByteBuffer.allocate(FTYP_HEAD_BYTES)
        while (head.hasRemaining()) {
            if (channel.read(head, head.position().toLong()) < 0) return false
        }
        val bytes = head.array()
        val boxSize =
            ((bytes[0].toLong() and 0xFF) shl 24) or ((bytes[1].toLong() and 0xFF) shl 16) or
                ((bytes[2].toLong() and 0xFF) shl 8) or (bytes[3].toLong() and 0xFF)
        // a size of 0 (to the end) or 1 (64-bit size follows) is legal in MP4; any other size below the header is not
        val sizeOk = boxSize == 0L || boxSize == 1L || boxSize >= FTYP_HEAD_BYTES
        return sizeOk && String(bytes, FTYP_TYPE_OFFSET, FTYP_HEAD_BYTES - FTYP_TYPE_OFFSET, Charsets.ISO_8859_1) == "ftyp"
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
     * Durability: the content was fsynced in the temporary file before the link; the directory entry of the new name is not fsynced separately (assumption:
     * the journal of the file system orders the link after the content; a power loss before it leaves the source in the camera cache).
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
    private fun confinedSource(
        uriText: String,
        kind: MediaKind,
    ): File? {
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
        if (!CaptureCache.matches(kind, file.name)) return null
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

    private fun confinedTarget(
        assetId: String,
        kind: MediaKind,
    ): File? =
        try {
            if (kind == MediaKind.VIDEO) files.videoOriginalFile(assetId) else files.originalFile(assetId)
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
        val videoCutoff = now() - maxOf(olderThanMs, VIDEO_MIN_AGE_MS)
        val keep = keepAssetIds.map { it.lowercase() }.toSet()
        val doomed =
            CaptureCache.regularFiles(files.originalsDirectory).filter { file ->
                val name = file.name
                val assetId = UploadFiles.assetIdOfOriginalName(name)
                val unknownOriginal = assetId != null && assetId !in keep
                (unknownOriginal || name.endsWith(AtomicFiles.TEMP_SUFFIX)) && file.lastModified() <= cutoff
            } +
                CaptureCache.regularFiles(files.cameraDirectory).filter {
                    when {
                        CaptureCache.CAMERA_FILE_NAME.matches(it.name) -> it.lastModified() <= cutoff

                        // a video the camera may still be writing: its age is counted from the last modification and never below the floor
                        CaptureCache.CAMERA_VIDEO_NAME.matches(it.name) -> it.lastModified() <= videoCutoff

                        else -> false
                    }
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
        /**
         * Are the two paths on one volume? The device number of the file (`unix:dev`: a `stat`, no table of mounts) where the platform has the view; else the
         * file store. `getFileStore` looks the mount up in `/proc/mounts`, which on Android can fail for the bind-mounted directories of an app, so it is only the
         * second choice. `null` = neither answered (a missing file, a platform without both): the caller must not assume anything.
         */
        fun sameVolume(
            first: Path,
            second: Path,
        ): Boolean? {
            val byDevice =
                runCatching { Files.getAttribute(first, "unix:dev") to Files.getAttribute(second, "unix:dev") }.getOrNull()
            if (byDevice != null && byDevice.first != null && byDevice.second != null) return byDevice.first == byDevice.second
            return runCatching { Files.getFileStore(first) == Files.getFileStore(second) }.getOrNull()
        }

        /** SR-FILE-01: the limit of a photo. */
        const val MAX_BYTES = 50L * 1024 * 1024

        /** SEC-110-06: the limit of a video from the phone; above the safety limit of the recording (500 MB) and far below the antivirus threshold (2 GB). */
        const val VIDEO_MAX_BYTES = 1_000_000_000L

        /** The sweep never removes a video of the camera cache younger than this (the longest recording is 5 minutes; age = last modification). */
        const val VIDEO_MIN_AGE_MS = 15L * 60 * 1000

        private const val FTYP_HEAD_BYTES = 8
        private const val FTYP_TYPE_OFFSET = 4

        /** Free space that must remain after the copy (the database and the next picture need room). */
        const val RESERVE_BYTES = 16L * 1024 * 1024

        private val JPEG_MAGIC = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
    }
}
