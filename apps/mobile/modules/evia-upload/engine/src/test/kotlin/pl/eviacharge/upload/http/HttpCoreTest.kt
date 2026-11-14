package pl.eviacharge.upload.http

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadFailure
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal fun testConfig(
    server: TestServer,
    storage: List<String> = listOf(server.authority),
    e2e: Boolean = true,
    readTimeoutMs: Int = 5_000,
    maxJsonBytes: Int = HttpConfig.MAX_JSON_BYTES,
) = HttpConfig(server.origin, storage, "1.2.3", e2e, 5_000, readTimeoutMs, maxJsonBytes)

/** EVM-130 AC1, AC2 (security 4, architect 3-5): the one HTTP policy of the module. */
class HttpCoreTest {
    private val servers = mutableListOf<TestServer>()
    private val cancel = CancelHandle()

    private fun server(handler: (Seen) -> Reply = { Reply(200, "{}") }) = TestServer(handler).also { servers.add(it) }

    private fun core(
        server: TestServer,
        stop: StopCheck = StopCheck.NEVER,
        readTimeoutMs: Int = 5_000,
        maxJsonBytes: Int = HttpConfig.MAX_JSON_BYTES,
    ) = HttpCore(testConfig(server, readTimeoutMs = readTimeoutMs, maxJsonBytes = maxJsonBytes), cancel, stop)

    @AfterEach
    fun tearDown() {
        Thread.interrupted()
        servers.forEach { it.close() }
    }

    // ---- configuration

    @Test
    fun `EVM-130 AC7 only https is accepted, http and a second host only in the e2e variant`() {
        val ok = HttpConfig("https://api.example.test", listOf("Store.Example.Test", "s3.example.test:8443"), "1.0.0")
        assertEquals("https://api.example.test", ok.apiOrigin)
        assertEquals("api.example.test", ok.apiAuthority)
        assertEquals(listOf("store.example.test", "s3.example.test:8443"), ok.storageHosts)
        assertEquals("https://api.example.test:8443", HttpConfig("HTTPS://API.example.test:8443/", listOf("a.test"), "1.0.0").apiOrigin)
        assertThrows(IllegalArgumentException::class.java) { HttpConfig("http://api.example.test", listOf("a.test"), "1.0.0") }
        assertEquals(
            "http://10.0.2.2:8080",
            HttpConfig("http://10.0.2.2:8080", listOf("10.0.2.2:8080"), "1.0.0", e2eCleartext = true).apiOrigin,
        )
        assertThrows(
            IllegalArgumentException::class.java,
        ) { HttpConfig("ftp://api.example.test", listOf("a.test"), "1.0.0", e2eCleartext = true) }
    }

    @Test
    fun `EVM-130 AC7 a bad address, host list, version or limit is refused without echoing the value`() {
        val bad: List<() -> HttpConfig> =
            listOf(
                { HttpConfig("https://user:pw@api.example.test", listOf("a.test"), "1.0.0") },
                { HttpConfig("https://api.example.test/prefix", listOf("a.test"), "1.0.0") },
                { HttpConfig("https://api.example.test?x=1", listOf("a.test"), "1.0.0") },
                { HttpConfig("https://api.example.test#f", listOf("a.test"), "1.0.0") },
                { HttpConfig("not a uri", listOf("a.test"), "1.0.0") },
                { HttpConfig("https://", listOf("a.test"), "1.0.0") },
                { HttpConfig("/relative", listOf("a.test"), "1.0.0") },
                { HttpConfig("https://api.example.test", emptyList(), "1.0.0") },
                { HttpConfig("https://api.example.test", listOf("bad host"), "1.0.0") },
                { HttpConfig("https://api.example.test", listOf("https://store.test"), "1.0.0") },
                { HttpConfig("https://api.example.test", listOf("a.test"), "1 0") },
                { HttpConfig("https://api.example.test", listOf("a.test"), "1.0.0", connectTimeoutMs = 0) },
                { HttpConfig("https://api.example.test", listOf("a.test"), "1.0.0", readTimeoutMs = 0) },
                { HttpConfig("https://api.example.test", listOf("a.test"), "1.0.0", maxJsonBytes = 0) },
                { HttpConfig("https://api.example.test/", listOf("a.test"), "1.0.0", readTimeoutMs = -1) },
                { HttpConfig("mailto:x@example.test", listOf("a.test"), "1.0.0") },
            )
        for (build in bad) {
            val error = assertThrows(IllegalArgumentException::class.java) { build() }
            assertFalse(error.message.orEmpty().contains("pw") || error.message.orEmpty().contains("example"))
        }
    }

    @Test
    fun `EVM-130 AC7 the Authorization host is matched exactly - another host, port, scheme or a lookalike never matches`() {
        val config = HttpConfig("https://api.example.test", listOf("a.test"), "1.0.0")
        assertTrue(config.isApiUrl(URL("https://api.example.test/api/v1/x")))
        assertTrue(config.isApiUrl(URL("https://API.example.test/x")))
        for (other in listOf(
            "https://api.example.test:444/x",
            "http://api.example.test/x",
            "https://evil.api.example.test/x",
            "https://api.example.test.evil.test/x",
            "https://store.example.test/x",
        )) {
            assertFalse(config.isApiUrl(URL(other)), other)
        }
        assertEquals("https://api.example.test/api/v1/a", config.apiUrl("/api/v1/a").toString())
        assertThrows(IllegalArgumentException::class.java) { config.apiUrl("/other") }
        assertThrows(IllegalArgumentException::class.java) { config.apiUrl("//evil.test/api/v1/") }
    }

    // ---- failure mapping

    @Test
    fun `EVM-130 AC2 a timeout and an I-O error are network failures, the result of a call is passed through`() {
        val core = core(server())
        assertEquals(5, core.guard { 5 })
        for (error in listOf<IOException>(SocketTimeoutException("Read timed out"), IOException("reset"))) {
            val thrown = assertThrows(UploadFailure::class.java) { core.guard { throw error } }
            assertEquals(Failure.Network, thrown.failure)
        }
        val own = UploadFailure(Failure.Http(500))
        assertEquals(own, assertThrows(UploadFailure::class.java) { core.guard { throw own } })
    }

    @Test
    fun `EVM-130 AC2 an interrupt, an interrupted I-O call and the flag of the thread are a cancel, never a network failure`() {
        val core = core(server())
        assertThrows(UploadCancelledException::class.java) { core.guard { throw InterruptedException("stop") } }
        assertTrue(Thread.interrupted())
        assertThrows(UploadCancelledException::class.java) { core.guard { throw InterruptedIOException("stop") } }
        assertTrue(Thread.interrupted())
        Thread.currentThread().interrupt()
        assertThrows(UploadCancelledException::class.java) { core.guard { 1 } }
        assertThrows(UploadCancelledException::class.java) { core.guard { throw IOException("closed") } }
        Thread.interrupted()
    }

    @Test
    fun `EVM-130 AC2 a closed connection after the cancel, also with a timeout in the message of the day, is a cancel`() {
        val core = core(server())
        val outcome =
            assertThrows(UploadCancelledException::class.java) {
                core.guard {
                    cancel.cancel()
                    throw SocketTimeoutException("closed")
                }
            }
        assertEquals("cancelled", outcome.message)
        assertTrue(cancel.cancelled)
        assertThrows(UploadCancelledException::class.java) { core.guard { 1 } }
        assertTrue(outcome.fillInStackTrace() === outcome)
    }

    @Test
    fun `EVM-130 AC5 a set wipe marker stops every call before it is made`() {
        val server = server()
        val core = core(server, stop = { true })
        assertThrows(UploadCancelledException::class.java) { core.json("GET", core.config.apiUrl("/api/v1/x"), emptyMap(), null) }
        assertTrue(server.requests.isEmpty())
    }

    // ---- real connections

    @Test
    fun `EVM-130 AC2 a json request carries the headers and the body, and the answer is read with its useful headers`() {
        val server = server { Reply(201, """{"ok":true}""", mapOf("Retry-After" to "7")) }
        val core = core(server)
        val answer =
            core.json(
                "POST",
                core.config.apiUrl("/api/v1/x"),
                mapOf("X-Test" to "1", "Authorization" to "Bearer a"),
                """{"a":1}""".toByteArray(),
            )
        assertEquals(201, answer.status)
        assertEquals("""{"ok":true}""", String(answer.body!!))
        assertEquals(7L, answer.retryAfterSeconds)
        assertNotNull(answer.dateMs)
        val seen = server.requests.single()
        assertEquals("POST", seen.method)
        assertEquals("/api/v1/x", seen.path)
        assertEquals("1", seen.headers["x-test"])
        assertEquals("""{"a":1}""", String(seen.body))
        assertEquals("7", seen.headers["content-length"])
    }

    @Test
    fun `EVM-130 AC2 an empty body is sent with Content-Length 0, no body at all with a GET, and a 204 has an empty answer`() {
        val server = server { Reply(204) }
        val core = core(server)
        val post = core.json("POST", core.config.apiUrl("/api/v1/x"), emptyMap(), ByteArray(0))
        assertEquals(204, post.status)
        assertEquals(0, post.body!!.size)
        assertEquals("0", server.requests.single().headers["content-length"])
        core.json("GET", core.config.apiUrl("/api/v1/y"), emptyMap(), null)
        assertEquals(2, server.requests.size)
    }

    @Test
    fun `EVM-130 AC2 an error answer is read too, and Retry-After accepts only delta-seconds`() {
        val values = listOf("7" to 7L, " 12 " to 12L, "Wed, 21 Oct 2026 07:28:00 GMT" to null, "-5" to null, "99999999" to null, "" to null)
        for ((header, expected) in values) {
            val server = server { Reply(429, """{"code":"rate_limited"}""", mapOf("Retry-After" to header)) }
            val core = core(server)
            val answer = core.json("GET", core.config.apiUrl("/api/v1/x"), emptyMap(), null)
            assertEquals(429, answer.status)
            assertEquals(expected, answer.retryAfterSeconds, header)
            assertEquals("rate_limited", answer.problemCode())
        }
    }

    @Test
    fun `EVM-130 AC2 an answer longer than the limit is not read into memory and reads as invalid`() {
        val server = server { Reply(200, "x".repeat(5000)) }
        val big = core(server, maxJsonBytes = 1000).json("GET", core(server).config.apiUrl("/api/v1/x"), emptyMap(), null)
        assertNull(big.body)
        assertNull(big.jsonObject())
        val fits = core(server, maxJsonBytes = 5000).json("GET", core(server).config.apiUrl("/api/v1/x"), emptyMap(), null)
        assertEquals(5000, fits.body!!.size)
        assertNull(fits.jsonObject())
        assertEquals(3, HttpCore.readLimited(ByteArrayInputStream(ByteArray(3)), 3)!!.size)
        assertNull(HttpCore.readLimited(ByteArrayInputStream(ByteArray(4)), 3))
    }

    @Test
    fun `EVM-130 AC2 a redirect is NOT followed - the other server sees no request and the answer is the 307`() {
        val target = server()
        val source = server { Reply(307, "", mapOf("Location" to "${target.origin}/stolen")) }
        val core = core(source)
        val answer =
            core.json(
                "POST",
                core.config.apiUrl("/api/v1/x"),
                mapOf("Authorization" to "Bearer secret"),
                """{"a":1}""".toByteArray(),
            )
        assertEquals(307, answer.status)
        assertEquals(1, source.requests.size)
        assertTrue(target.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 Authorization is added to the API host only`() {
        val api = server()
        val core = core(api)
        val error =
            assertThrows(IllegalArgumentException::class.java) {
                core.json(
                    "GET",
                    URL("http://127.0.0.1:1/api/v1/x"),
                    mapOf("authorization" to "Bearer x"),
                    null,
                )
            }
        assertFalse(error.message.orEmpty().contains("Bearer"))
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 a read timeout is a network failure, and so is a refused connection, with the send probe telling where it failed`() {
        val slow =
            server {
                Thread.sleep(1500)
                Reply(200, "{}")
            }
        val probe = SendProbe()
        val timeout =
            assertThrows(UploadFailure::class.java) {
                core(
                    slow,
                    readTimeoutMs = 300,
                ).json("POST", slow.let { core(it).config.apiUrl("/api/v1/x") }, emptyMap(), "{}".toByteArray(), probe)
            }
        assertEquals(Failure.Network, timeout.failure)
        assertTrue(probe.sent)
        val port = slow.port
        slow.close()
        val refused = SendProbe()
        val config = HttpConfig("http://127.0.0.1:$port", listOf("127.0.0.1:$port"), "1.0.0", true, 1000, 1000)
        val thrown =
            assertThrows(UploadFailure::class.java) {
                HttpCore(
                    config,
                    CancelHandle(),
                    StopCheck.NEVER,
                ).json("POST", config.apiUrl("/api/v1/x"), emptyMap(), "{}".toByteArray(), refused)
            }
        assertEquals(Failure.Network, thrown.failure)
        assertFalse(refused.sent)
    }

    @Test
    fun `EVM-130 AC2 stopping the job closes the connection that waits for an answer - a cancel, in a short time`() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val server =
            server {
                entered.countDown()
                release.await(10, TimeUnit.SECONDS)
                Reply(200, "{}")
            }
        val core = core(server)
        val result = AtomicReference<Throwable>()
        val worker =
            Thread {
                try {
                    core.json("GET", core.config.apiUrl("/api/v1/x"), emptyMap(), null)
                } catch (
                    error: Throwable,
                ) {
                    result.set(error)
                }
            }
        worker.start()
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        cancel.cancel()
        worker.join(5000)
        release.countDown()
        assertFalse(worker.isAlive)
        assertTrue(result.get() is UploadCancelledException, result.get().toString())
    }

    @Test
    fun `EVM-130 AC2 an interrupt of the thread alone, without a closed connection, ends the call as a cancel after the timeout`() {
        val entered = CountDownLatch(1)
        val server =
            server {
                entered.countDown()
                Thread.sleep(1500)
                Reply(200, "{}")
            }
        val core = core(server, readTimeoutMs = 400)
        val result = AtomicReference<Throwable>()
        val worker =
            Thread {
                try {
                    core.json("GET", core.config.apiUrl("/api/v1/x"), emptyMap(), null)
                } catch (
                    error: Throwable,
                ) {
                    result.set(error)
                }
            }
        worker.start()
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        worker.interrupt()
        worker.join(5000)
        assertTrue(result.get() is UploadCancelledException, result.get().toString())
    }

    @Test
    fun `EVM-130 AC2 a connection attached after the cancel is closed at once`() {
        val server = server()
        val handle = CancelHandle()
        handle.cancel()
        val connection = HttpCore(testConfig(server), handle, StopCheck.NEVER).open(URL("${server.origin}/x"), "GET")
        handle.attach(connection)
        assertTrue(handle.cancelled)
        handle.detach()
        assertFalse(connection.instanceFollowRedirects)
        assertEquals(5_000, connection.connectTimeout)
    }
}
