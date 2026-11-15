package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

private const val SIGNED =
    "https://store.example.test/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=cred%2F2026&X-Amz-Signature=deadbeef"
private val FORBIDDEN = Regex("(?i)https?://|x-amz|x%2damz|bearer\\s+[a-z0-9]|deadbeef|store\\.example")

class RedactingLoggerTest {
    private val lines = mutableListOf<String>()
    private val logger = RedactingLogger { lines.add(it) }

    @Test
    fun `EVM-109 AC3 an address, a bearer token and X-Amz parameters never reach the log`() {
        logger.event("part_sent", mapOf("part" to "1", "status" to "see $SIGNED and Bearer abc.def.ghi"))
        logger.event("note", mapOf("code" to "X-Amz-Signature=deadbeef x-amz-date:20260101T000000Z"))
        lines.forEach { assertFalse(FORBIDDEN.containsMatchIn(it), it) }
        assertTrue(lines.first().startsWith("part_sent part=1"))
    }

    @Test
    fun `EVM-109 AC3 percent-encoded names are decoded before redaction`() {
        assertEquals("note [redacted]", Redactor.redact("note X%2DAmz%2DDate"))
        assertFalse(Redactor.redact("x%2Damz%2Dsignature%3Ddeadbeef").contains("deadbeef"))
        assertEquals("100% sure %zz %7F", Redactor.redact("100% sure %zz %7F"))
    }

    @Test
    fun `EVM-109 AC3 signature, credential and authorization assignments are redacted`() {
        assertEquals("Signature=[redacted] ok", Redactor.redact("Signature=abc123 ok"))
        assertEquals("Credential=[redacted]", Redactor.redact("Credential: cred-example/2026"))
        assertEquals("authorization=[redacted]", Redactor.redact("authorization: Basic xyz"))
        assertEquals("Bearer [redacted]", Redactor.redact("BEARER secrettoken"))
    }

    @Test
    fun `EVM-109 AC3 token-like strings are redacted but identifiers of the engine stay readable`() {
        val token = "a1b2c3d4e5".repeat(4)
        assertEquals("hash=[token]", Redactor.redact("hash=$token"))
        val uuid = "0191f0a8-1234-7abc-8def-0123456789ab"
        assertEquals("session $uuid", Redactor.redact("session $uuid"))
    }

    @Test
    fun `EVM-130 AC5 a token without digits is masked too, only UUIDs stay readable`() {
        val base64url = "AlphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappa"
        assertTrue(base64url.none { it.isDigit() })
        assertEquals("token [token]", Redactor.redact("token $base64url"))
        assertEquals("[token]", Redactor.redact("a".repeat(40)))
        assertEquals("[token]", Redactor.redact("Zm9vYmFyLWJheg_-ZmFyYm9vLWJheg_-Zm9vYmFy"))
        val uuid = "0191f0a8-1234-7abc-8def-0123456789ab"
        assertEquals("asset=$uuid", Redactor.redact("asset=$uuid"))
    }

    @Test
    fun `EVM-109 AC3 EVM-130 AC5 an exception is logged by its class only, never by message, cause or stack`() {
        val cause = IOException("connect failed for $SIGNED")
        val failure = IllegalStateException("upload failed: Bearer topsecret123 at $SIGNED", cause)
        logger.error("part_failed", failure)
        assertEquals(listOf("part_failed error=IllegalStateException"), lines)
        lines.forEach { assertFalse(FORBIDDEN.containsMatchIn(it), it) }
    }

    @Test
    fun `EVM-130 AC5 the logger never reads the message or toString of an exception`() {
        val untouchable =
            object : RuntimeException() {
                override val message: String get() = throw AssertionError("message was read")

                override fun toString(): String = throw AssertionError("toString was read")
            }
        logger.error("never_read", untouchable)
        assertEquals(1, lines.size)
        assertTrue(lines.single().startsWith("never_read error="))
    }

    @Test
    fun `EVM-130 AC5 an upload failure is logged with its code, a network failure without any`() {
        logger.error("api", UploadFailure(Failure.Http(401, "session_revoked")))
        logger.error("api", UploadFailure(Failure.Http(503)))
        logger.error("part", UploadFailure(Failure.Network))
        assertEquals(
            listOf(
                "api error=UploadFailure failure=http 401 session_revoked",
                "api error=UploadFailure failure=http 503",
                "part error=UploadFailure failure=network",
            ),
            lines,
        )
    }

    @Test
    fun `EVM-109 AC3 keys outside the allowlist are dropped`() {
        logger.error("no_message", RuntimeException())
        logger.event("custom", mapOf("filename" to "kitchen.jpg", "owner" to "Jan Kowalski", "part" to "2"))
        assertEquals("no_message error=RuntimeException", lines.first())
        assertEquals("custom part=2", lines.last())
        assertTrue(RedactingLogger.FIELD_ALLOWLIST.none { it in setOf("filename", "owner", "url", "token", "description") })
    }

    @Test
    fun `EVM-109 AC3 the silent logger accepts events`() {
        RedactingLogger.NONE.event("anything")
        RedactingLogger.NONE.error("anything", RuntimeException("x"))
    }
}
