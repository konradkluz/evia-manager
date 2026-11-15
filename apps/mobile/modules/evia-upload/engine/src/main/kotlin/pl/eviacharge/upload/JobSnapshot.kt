package pl.eviacharge.upload

enum class JobState(
    val wire: String,
) {
    ACTIVE("active"),
    PAUSED_REVOKED("paused_revoked"),
    UPLOADED("uploaded"),
    ;

    companion object {
        fun fromWire(value: String?): JobState? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * Persisted state of one job: identifiers, sizes and counters only. No tokens, addresses, names or descriptions (SR-MOB-01); the
 * serialized form is [toFields] and its keys are the allowlist [FIELD_NAMES].
 */
data class JobSnapshot(
    val schemaVersion: Int,
    val assetId: String,
    val size: Long,
    val uploadSessionId: String,
    val idempotencyKey: String,
    val partSize: Long?,
    val partCount: Int?,
    val completeSent: Boolean,
    val state: JobState,
    /** Informational only (the server does not trust client ETags). */
    val etags: Map<String, String>,
) {
    fun toFields(): Map<String, Any?> =
        linkedMapOf(
            "schemaVersion" to schemaVersion,
            "assetId" to assetId,
            "size" to size,
            "uploadSessionId" to uploadSessionId,
            "idempotencyKey" to idempotencyKey,
            "partSize" to partSize,
            "partCount" to partCount,
            "completeSent" to completeSent,
            "state" to state.wire,
            "etags" to etags,
        )

    companion object {
        val FIELD_NAMES: Set<String> =
            setOf(
                "schemaVersion",
                "assetId",
                "size",
                "uploadSessionId",
                "idempotencyKey",
                "partSize",
                "partCount",
                "completeSent",
                "state",
                "etags",
            )

        /** Reads a stored form; `null` when the shape is not recognised (the engine then starts the job from the beginning). */
        fun fromFields(fields: Map<String, Any?>): JobSnapshot? {
            val etags = (fields["etags"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value.toString() } ?: return null
            return JobSnapshot(
                schemaVersion = (fields["schemaVersion"] as? Number)?.toInt() ?: return null,
                assetId = fields["assetId"] as? String ?: return null,
                size = (fields["size"] as? Number)?.toLong() ?: return null,
                uploadSessionId = fields["uploadSessionId"] as? String ?: return null,
                idempotencyKey = fields["idempotencyKey"] as? String ?: return null,
                partSize = (fields["partSize"] as? Number)?.toLong(),
                partCount = (fields["partCount"] as? Number)?.toInt(),
                completeSent = fields["completeSent"] as? Boolean ?: return null,
                state = JobState.fromWire(fields["state"] as? String) ?: return null,
                etags = etags,
            )
        }
    }
}
