package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** EVM-130 AC7 (architect 5): `http` part addresses exist only in the e2e variant of the build. */
class CleartextPartUrlTest {
    private val hosts = listOf("store.example.test", "s3.example.test:8080")

    @Test
    fun `EVM-130 AC7 http is refused unless the e2e variant says otherwise, https stays fine either way`() {
        assertFalse(isTrustedPartUrl("http://store.example.test/x", hosts))
        assertFalse(isTrustedPartUrl("http://store.example.test/x", hosts, allowCleartext = false))
        assertTrue(isTrustedPartUrl("http://store.example.test/x", hosts, allowCleartext = true))
        assertTrue(isTrustedPartUrl("HTTP://STORE.example.test/x?X-Amz-Signature=s", hosts, allowCleartext = true))
        assertTrue(isTrustedPartUrl("http://s3.example.test:8080/x", hosts, allowCleartext = true))
        assertFalse(isTrustedPartUrl("http://s3.example.test:8081/x", hosts, allowCleartext = true))
        assertFalse(isTrustedPartUrl("http://s3.example.test/x", hosts, allowCleartext = true))
        assertTrue(isTrustedPartUrl("https://store.example.test/x", hosts, allowCleartext = true))
        assertFalse(isTrustedPartUrl("ftp://store.example.test/x", hosts, allowCleartext = true))
        assertFalse(isTrustedPartUrl("http://user@store.example.test/x", hosts, allowCleartext = true))
        assertFalse(isTrustedPartUrl("http://evil.test/x", hosts, allowCleartext = true))
    }
}
