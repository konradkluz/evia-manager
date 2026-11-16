package pl.eviacharge.upload.files

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption

private val ASSET_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

/** An identifier that is not what it must be; the message never carries the value (it could be a path). */
class InvalidIdentifierException : IllegalArgumentException("invalid identifier")

/**
 * The layout of the private files of the module below [root] (`noBackupFilesDir` of the app, credential-encrypted storage, no backup).
 * A path is built here and nowhere else: from a name checked against a regular expression, relative to the base directory — never
 * from a value read from a job file (CWE-22).
 */
class UploadFiles(
    val root: File,
    /** Where the camera leaves a picture (`cacheDir/Camera` of the app): read by the import, emptied by the wipe and at sign-out. */
    val cameraDirectory: File = File(root, "camera-cache"),
    private val canonicalize: (File) -> File = { it.canonicalFile },
) {
    val jobsDirectory = File(root, "jobs")
    val originalsDirectory = File(root, "originals")
    val tokenFile = File(root, "token.bin")
    val wipeMarkerFile = File(root, "wipe.marker")
    val contactFile = File(root, "contact.json")
    val jobIdsFile = File(root, "job-ids.json")

    /** The setting "videos only over Wi-Fi" (EVM-110): not removed by the sign-out or the wipe. */
    val settingsFile = File(root, "video-wifi-only.txt")

    /**
     * The original of a job; [assetId] is a lower-case UUID. A picture is `originals/<assetId>`; a video (EVM-110) is `originals/<assetId>.mp4`.
     * The answer is the video when that file exists, otherwise the plain name: every consumer (arming, digest, transport, removal) works with
     * both kinds without knowing the type, and the path of a picture is the one it always was.
     */
    fun originalFile(assetId: String): File {
        val video = videoOriginalFile(assetId)
        return if (Files.isRegularFile(video.toPath(), LinkOption.NOFOLLOW_LINKS)) video else confined(originalsDirectory, assetId)
    }

    /** Where the import puts a video: `originals/<assetId>.mp4`. */
    fun videoOriginalFile(assetId: String): File = confined(originalsDirectory, "$assetId$VIDEO_SUFFIX", assetId)

    /** Both names an original can have; removal tries both. */
    fun originalFiles(assetId: String): List<File> = listOf(confined(originalsDirectory, assetId), videoOriginalFile(assetId))

    /** The file of a job: `jobs/<assetId>.json`. */
    fun jobFile(assetId: String): File = confined(jobsDirectory, "$assetId.json", assetId)

    private fun confined(
        directory: File,
        name: String,
        assetId: String = name,
    ): File {
        if (!ASSET_ID.matches(assetId)) throw InvalidIdentifierException()
        val file = File(directory, name)
        // defence in depth: the name is a UUID, so this holds, unless the directory itself points somewhere else
        if (!canonicalize(file).toPath().startsWith(canonicalize(directory).toPath())) throw InvalidIdentifierException()
        return file
    }

    companion object {
        const val VIDEO_SUFFIX = ".mp4"

        /** The asset id of an original's file name (`<uuid>` or `<uuid>.mp4`), or `null` when the name is neither. */
        fun assetIdOfOriginalName(name: String): String? = name.removeSuffix(VIDEO_SUFFIX).takeIf { isAssetId(it) }

        fun isAssetId(value: String): Boolean = ASSET_ID.matches(value)
    }
}
