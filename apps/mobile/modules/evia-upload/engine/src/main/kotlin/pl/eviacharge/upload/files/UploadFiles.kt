package pl.eviacharge.upload.files

import java.io.File

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
    private val canonicalize: (File) -> File = { it.canonicalFile },
) {
    val jobsDirectory = File(root, "jobs")
    val originalsDirectory = File(root, "originals")
    val tokenFile = File(root, "token.bin")
    val wipeMarkerFile = File(root, "wipe.marker")
    val contactFile = File(root, "contact.json")
    val jobIdsFile = File(root, "job-ids.json")

    /** The original of a job: `originals/<assetId>`; [assetId] is a lower-case UUID. */
    fun originalFile(assetId: String): File = confined(originalsDirectory, assetId)

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
        fun isAssetId(value: String): Boolean = ASSET_ID.matches(value)
    }
}
