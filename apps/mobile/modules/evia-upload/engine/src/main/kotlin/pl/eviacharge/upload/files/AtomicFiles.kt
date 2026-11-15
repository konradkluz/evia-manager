package pl.eviacharge.upload.files

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * The only way the module writes a file: a temporary file next to the target, `fsync`, then an atomic rename. A reader sees the old or
 * the whole new content, never half (a killed process, a restart of the phone). Failures carry no message: a path must not reach a log.
 */
object AtomicFiles {
    const val TEMP_SUFFIX = ".tmp"

    @Throws(IOException::class)
    fun write(
        target: File,
        bytes: ByteArray,
    ) {
        // a file system root has no parent: nothing to write next to (the stricter Android compiler flags the platform type)
        val parent = target.absoluteFile.parentFile ?: throw IOException("atomic write failed")
        val temp = File(parent, target.name + TEMP_SUFFIX)
        try {
            Files.createDirectories(parent.toPath())
            FileOutputStream(temp).use { stream ->
                stream.write(bytes)
                stream.flush()
                stream.fd.sync()
            }
            Files.move(temp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (error: IOException) {
            temp.delete()
            throw IOException("atomic write failed")
        }
    }

    /** The whole file, or `null` when it is missing, not a regular file, longer than [maxBytes] or cannot be read. */
    fun read(
        file: File,
        maxBytes: Int,
    ): ByteArray? =
        try {
            if (file.isFile && file.length() <= maxBytes) Files.readAllBytes(file.toPath()) else null
        } catch (error: IOException) {
            null
        }

    @Throws(IOException::class)
    fun delete(file: File) {
        try {
            Files.deleteIfExists(file.toPath())
        } catch (error: IOException) {
            throw IOException("delete failed")
        }
    }

    /** Removes the directory with everything in it; `false` when something stayed. A missing directory is done. */
    fun deleteTree(directory: File): Boolean = !directory.exists() || directory.deleteRecursively()

    /** Leftovers of interrupted writes below [root]. */
    fun temporaryFiles(root: File): List<File> = root.walkTopDown().filter { it.isFile && it.name.endsWith(TEMP_SUFFIX) }.toList()
}
