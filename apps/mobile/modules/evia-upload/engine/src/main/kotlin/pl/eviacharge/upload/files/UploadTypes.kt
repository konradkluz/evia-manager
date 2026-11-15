package pl.eviacharge.upload.files

import pl.eviacharge.upload.FileDeclaration

/**
 * What the phone may declare about a file in the upload session (EVM-131 contract `UploadFileDeclaration`; the same rules as the allow-list
 * of the server, `file-rules.ts`): the type is from the allow-list and the name is made here from the identifier of the asset and the extension
 * of the type - NEVER a name from the user. Pure; the same table is in the TypeScript model (`packages/sync-core/src/upload/declaration.ts`) and the
 * vectors `conformance/upload/declaration.json` hold both to it.
 */
object UploadTypes {
    /** Content type -> extension of the name; the order is the order of the contract. */
    val EXTENSIONS: Map<String, String> =
        linkedMapOf(
            "image/jpeg" to "jpg",
            "image/png" to "png",
            "image/webp" to "webp",
            "image/heic" to "heic",
            "video/mp4" to "mp4",
            "video/quicktime" to "mov",
        )

    private val ALIASES = mapOf("image/jpg" to "image/jpeg", "image/heif" to "image/heic")
    private val SHA256 = Regex("^[a-f0-9]{64}$")
    private val FILE_NAME = Regex("^[A-Za-z0-9-]{1,64}[.][a-z0-9]{1,5}$")

    /** The type of the allow-list for [value] (case and the aliases of the server are accepted), or `null`. */
    fun normalize(value: String): String? {
        val lower = value.trim().lowercase()
        val type = ALIASES[lower] ?: lower
        return type.takeIf { it in EXTENSIONS }
    }

    /** `<assetId>.<extension of the type>`; a type outside the list gets `bin` (the declaration is then refused by [isDeclarable]). */
    fun fileNameFor(
        assetId: String,
        contentType: String,
    ): String = "$assetId.${EXTENSIONS[contentType] ?: "bin"}"

    fun isSha256(value: String): Boolean = SHA256.matches(value)

    /** `true` when [file] is a declaration the server can accept: allow-listed type, a name that matches it, a positive size within the limit, a checksum. */
    fun isDeclarable(file: FileDeclaration): Boolean =
        file.contentType in EXTENSIONS &&
            FILE_NAME.matches(file.fileName) &&
            file.fileName.substringAfterLast('.') == EXTENSIONS[file.contentType] &&
            file.declaredSize in 1..MAX_BYTES &&
            isSha256(file.sha256)

    /** 4 GiB: the limit of a video in the contract (`UploadFileDeclaration.declaredSize`). */
    const val MAX_BYTES = 4_294_967_296L
}
