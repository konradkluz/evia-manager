package pl.eviacharge.upload

/** Destination of already redacted lines (EVM-130 provides the platform sink; `android.util.Log` is forbidden in module sources). */
fun interface LogSink {
    fun write(line: String)
}

private val PERCENT_ESCAPE = Regex("%([0-9A-Fa-f]{2})")
private val URL = Regex("[A-Za-z][A-Za-z0-9+.\\-]*://\\S*")
private val BEARER = Regex("(?i)\\bbearer\\s+\\S+")
private val ASSIGNMENT =
    Regex(
        "(?i)\\b(x-amz-[a-z0-9\\-]*|signature|credential|token|secret|password|access[_-]?key)\\b\\s*[=:]\\s*\\S+",
    )
private val AUTHORIZATION = Regex("(?i)\\bauthorization\\b\\s*[=:][^\\r\\n]*")
private val AMZ_NAME = Regex("(?i)x-amz-[a-z0-9\\-]+")
private val TOKEN_LIKE = Regex("[A-Za-z0-9_+/\\-]{32,}")
private val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
private const val ASCII_PRINTABLE_FROM = 0x20
private const val ASCII_PRINTABLE_TO = 0x7e

/** Last line of defence: removes addresses, tokens and signature material from any text (SR-LOG-02, TM-86). */
object Redactor {
    fun redact(text: String): String {
        // Percent-encoded names (`X%2DAmz%2DSignature%3D...`) are decoded first, so the patterns below see them.
        var result =
            PERCENT_ESCAPE.replace(text) { match ->
                val code = match.groupValues[1].toInt(radix = 16)
                if (code in ASCII_PRINTABLE_FROM..ASCII_PRINTABLE_TO) code.toChar().toString() else match.value
            }
        result = URL.replace(result, "[url]")
        result = BEARER.replace(result, "Bearer [redacted]")
        result = AUTHORIZATION.replace(result, "authorization=[redacted]")
        result = ASSIGNMENT.replace(result) { "${it.groupValues[1]}=[redacted]" }
        result = AMZ_NAME.replace(result, "[redacted]")
        return TOKEN_LIKE.replace(result) { match ->
            // every long token-like string is masked, also one without digits (base64url tokens can have none); only UUIDs stay readable
            if (UUID.matches(match.value)) match.value else "[token]"
        }
    }
}

/**
 * The only way the engine logs (EVM-109 AC3). It takes an event code and fields from an allowlist, never free text; every value still
 * goes through [Redactor]. Exceptions of HTTP clients often carry the signed address in their message, so they are logged by class only.
 */
class RedactingLogger(
    private val sink: LogSink,
) {
    fun event(
        code: String,
        fields: Map<String, String> = emptyMap(),
    ) {
        val allowed = fields.filterKeys { it in FIELD_ALLOWLIST }.map { (key, value) -> "$key=${Redactor.redact(value)}" }
        sink.write((listOf(Redactor.redact(code)) + allowed).joinToString(" "))
    }

    /**
     * An exception is logged as the name of its class and, for [UploadFailure], the code of the failure (`network`, or the HTTP status and
     * the problem `code`) - NEVER its message, its `toString`, its cause or its stack: messages of I/O exceptions can carry the whole
     * signed address (security 5, CWE-532). This method does not read them at all.
     */
    fun error(
        code: String,
        error: Throwable,
    ) {
        val detail = if (error is UploadFailure) " failure=${describe(error.failure)}" else ""
        sink.write(Redactor.redact("$code error=${error.javaClass.name.substringAfterLast('.')}$detail"))
    }

    private fun describe(failure: Failure): String =
        when (failure) {
            is Failure.Network -> "network"
            is Failure.Http -> listOfNotNull("http", failure.status.toString(), failure.code).joinToString(" ")
        }

    companion object {
        val FIELD_ALLOWLIST: Set<String> = setOf("asset", "session", "part", "attempt", "delayMs", "outcome", "reason", "status", "code")

        val NONE = RedactingLogger { }
    }
}
