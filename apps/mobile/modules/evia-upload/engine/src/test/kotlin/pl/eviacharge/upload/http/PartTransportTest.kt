package pl.eviacharge.upload.http

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.OriginalMissingException
import pl.eviacharge.upload.PartRequest
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadFailure
import java.io.File

/** EVM-130 AC1, AC2, AC4 (security 4, 6): the PUT of one part straight from the original. */
class PartTransportTest {
    @TempDir
    lateinit var directory: File

    private val servers = mutableListOf<TestServer>()
    private val cancel = CancelHandle()

    @AfterEach
    fun tearDown() {
        Thread.interrupted()
        servers.forEach { it.close() }
    }

    private fun server(
        handler: (Seen) -> Reply = {
            Reply(200, "", mapOf("ETag" to "\"etag-1\""))
        },
    ) = TestServer(handler).also { servers.add(it) }

    private fun original(size: Int): File =
        File(directory, "original").also { file ->
            file.writeBytes(
                ByteArray(size) {
                    (it % 251).toByte()
                },
            )
        }

    private fun transport(
        server: TestServer,
        original: File,
        stop: StopCheck = StopCheck.NEVER,
        e2e: Boolean = true,
    ): HttpPartTransport {
        // a release build has no e2e flag: its API address is https, and `http` part addresses are not accepted
        val config = if (e2e) testConfig(server) else HttpConfig("https://api.example.test", listOf(server.authority), "1.0.0")
        return HttpPartTransport(HttpCore(config, cancel, stop), cancel, stop, original)
    }

    private fun request(
        server: TestServer,
        offset: Long,
        length: Long,
        path: String = "/bucket/key?X-Amz-Signature=sig&X-Amz-Expires=3600",
    ) = PartRequest(
        "${server.origin}$path",
        offset,
        length,
        mapOf("Content-Length" to length.toString(), "Authorization" to "Bearer leaked"),
    )

    @Test
    fun `EVM-130 AC1 the part is the exact range of the original, with Content-Length only, a fixed length and no Authorization`() {
        val server = server()
        val file = original(100)
        val etag = transport(server, file).put(request(server, 16, 40))
        assertEquals("\"etag-1\"", etag)
        val seen = server.requests.single()
        assertEquals("PUT", seen.method)
        assertEquals("/bucket/key", seen.path)
        assertEquals("40", seen.headers["content-length"])
        assertNull(seen.headers["authorization"])
        assertNull(seen.headers["transfer-encoding"])
        assertArrayEquals(file.readBytes().copyOfRange(16, 56), seen.body)
    }

    @Test
    fun `EVM-130 AC1 a part larger than a buffer and the checks of the stop are sent whole`() {
        val server = server()
        val file = original(3 * 1024 * 1024 + 17)
        server.keepBodyBytes = Int.MAX_VALUE
        transport(server, file).put(request(server, 0, file.length()))
        assertArrayEquals(file.readBytes(), server.requests.single().body)
    }

    @Test
    fun `EVM-130 AC2 a part without an ETag header is fine, informational only`() {
        val server = server { Reply(200) }
        assertNull(transport(server, original(10)).put(request(server, 0, 10)))
    }

    @Test
    fun `EVM-130 AC2 a 403 of the storage is a 403, 429 carries Retry-After, others only their status`() {
        for ((status, expected) in listOf(403 to Failure.Http(403), 500 to Failure.Http(500), 400 to Failure.Http(400))) {
            val server = server { Reply(status, "<Error/>") }
            val failure = assertThrows(UploadFailure::class.java) { transport(server, original(10)).put(request(server, 0, 10)) }.failure
            assertEquals(expected, failure)
        }
        val limited = server { Reply(429, "", mapOf("Retry-After" to "7")) }
        assertEquals(
            Failure.Http(429, null, 7L),
            assertThrows(UploadFailure::class.java) {
                transport(limited, original(10)).put(request(limited, 0, 10))
            }.failure,
        )
    }

    @Test
    fun `EVM-130 AC2 a redirect of the storage is not followed - the part never goes to another host`() {
        val target = server()
        val source = server { Reply(307, "", mapOf("Location" to "${target.origin}/elsewhere")) }
        val failure = assertThrows(UploadFailure::class.java) { transport(source, original(10)).put(request(source, 0, 10)) }.failure
        assertEquals(Failure.Http(307), failure)
        assertTrue(target.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 an address outside the hosts of the build, with userinfo, or http in a release is refused before any connection`() {
        val server = server()
        val file = original(10)
        val other = PartRequest("http://127.0.0.1:1/x", 0, 10, emptyMap())
        val userinfo = PartRequest("${server.origin.replace("//", "//user:pw@")}/x", 0, 10, emptyMap())
        for (bad in listOf(other, userinfo)) {
            assertEquals(Failure.Http(400), assertThrows(UploadFailure::class.java) { transport(server, file).put(bad) }.failure)
        }
        val release = transport(server, file, e2e = false)
        assertEquals(Failure.Http(400), assertThrows(UploadFailure::class.java) { release.put(request(server, 0, 10)) }.failure)
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC5 a missing, short or shrunk original ends the work without a failure and without a path`() {
        val server = server()
        val missing =
            assertThrows(OriginalMissingException::class.java) { transport(server, File(directory, "gone")).put(request(server, 0, 10)) }
        assertFalse(missing.message.orEmpty().contains(directory.name))
        assertThrows(OriginalMissingException::class.java) { transport(server, original(10)).put(request(server, 5, 10)) }
        val liar =
            object : File(original(10).path) {
                override fun length(): Long = 1000L
            }
        assertThrows(OriginalMissingException::class.java) { transport(server, liar).put(request(server, 0, 50)) }
        assertTrue(missing.fillInStackTrace() === missing)
    }

    @Test
    fun `EVM-130 AC2 the stop in the middle of a part - the wipe marker, the cancel handle and the interrupt flag - ends it as a cancel`() {
        val server = server()
        val file = original(3 * 1024 * 1024)
        var calls = 0
        assertThrows(UploadCancelledException::class.java) {
            transport(server, file, stop = { ++calls > 1 }).put(request(server, 0, file.length()))
        }
        calls = 0
        val handle = CancelHandle()
        val fromCancel =
            StopCheck {
                if (++calls == 2) handle.cancel()
                false
            }
        val core = HttpCore(testConfig(server), handle, fromCancel)
        assertThrows(UploadCancelledException::class.java) {
            HttpPartTransport(core, handle, fromCancel, file).put(request(server, 0, file.length()))
        }
        calls = 0
        val interrupting =
            StopCheck {
                if (++calls == 2) Thread.currentThread().interrupt()
                false
            }
        val interruptible =
            HttpPartTransport(HttpCore(testConfig(server), CancelHandle(), interrupting), CancelHandle(), interrupting, file)
        assertThrows(UploadCancelledException::class.java) { interruptible.put(request(server, 0, file.length())) }
    }
}
