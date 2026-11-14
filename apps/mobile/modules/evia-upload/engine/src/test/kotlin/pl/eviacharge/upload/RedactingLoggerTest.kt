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
        assertEquals("a".repeat(40), Redactor.redact("a".repeat(40)))
    }

    @Test
    fun `EVM-109 AC3 the message, the whole cause chain and the stack trace of an exception are redacted`() {
        val cause = IOException("connect failed for $SIGNED")
        val failure = IllegalStateException("upload failed: Bearer topsecret123 at $SIGNED", cause)
        logger.error("part_failed", failure)
        assertTrue(lines.size > 3)
        lines.forEach { assertFalse(FORBIDDEN.containsMatchIn(it), it) }
        assertTrue(lines.any { it.startsWith("IllegalStateException:") })
        assertTrue(lines.any { it.startsWith("IOException:") })
        assertTrue(lines.any { it.startsWith("  at ") })
    }

    @Test
    fun `EVM-109 AC3 a cyclic cause chain terminates`() {
        val first = RuntimeException("first")
        val second = RuntimeException("second", first)
        first.initCause(second)
        logger.error("cycle", first)
        assertEquals(2, lines.count { it.startsWith("RuntimeException:") })
    }

    @Test
    fun `EVM-109 AC3 a missing message and keys outside the allowlist are dropped`() {
        logger.error("no_message", RuntimeException())
        logger.event("custom", mapOf("filename" to "kitchen.jpg", "owner" to "Jan Kowalski", "part" to "2"))
        assertTrue(lines.contains("RuntimeException: "))
        assertEquals("custom part=2", lines.last())
        assertTrue(RedactingLogger.FIELD_ALLOWLIST.none { it in setOf("filename", "owner", "url", "token", "description") })
    }

    @Test
    fun `EVM-109 AC3 the silent logger accepts events`() {
        RedactingLogger.NONE.event("anything")
        RedactingLogger.NONE.error("anything", RuntimeException("x"))
    }
}
