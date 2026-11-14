package pl.eviacharge.upload.http

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.FileState
import pl.eviacharge.upload.Json
import pl.eviacharge.upload.PartUrl
import pl.eviacharge.upload.RemotePart
import pl.eviacharge.upload.SessionInfo
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadFailure
import pl.eviacharge.upload.session.ApiSession
import pl.eviacharge.upload.session.LogoutAnswer
import pl.eviacharge.upload.session.RefreshAnswer
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenResult

private const val WO = "0193a000-0000-7000-8000-0000000000d1"
private const val ASSET = "0193a000-0000-7000-8000-00000000000a"
private const val SESSION = "0193a000-0000-7000-8000-0000000000c1"
private const val KEY = "0193a000-0000-7000-8000-0000000000c2"
private val BASE = "/api/v1/work-orders/$WO/media-assets/$ASSET/upload-sessions"

private class FakeSession(
    var tokens: MutableList<TokenResult> = mutableListOf(TokenResult.Ready("access-1", "u:d")),
) : ApiSession {
    val events = mutableListOf<String>()

    override fun accessToken(): TokenResult = tokens.removeAt(0).also { events.add("token") }

    override fun accessTokenRejected(rejected: String): TokenResult {
        events.add("rejected:$rejected")
        return tokens.removeAt(0)
    }

    override fun onApiRevoked() {
        events.add("revoked")
    }

    override fun onApiWipeRequired() {
        events.add("wipe")
    }

    override fun onApiUpdateRequired() {
        events.add("update")
    }
}

/** EVM-130 AC1, AC2, AC4: the API adapters of the upload and of the session, against a real server of the JDK. */
class ApiAdaptersTest {
    private val servers = mutableListOf<TestServer>()
    private val contacts = mutableListOf<Long?>()
    private val session = FakeSession()

    @AfterEach
    fun tearDown() {
        Thread.interrupted()
        servers.forEach { it.close() }
    }

    private fun server(handler: (Seen) -> Reply) = TestServer(handler).also { servers.add(it) }

    private fun api(
        server: TestServer,
        stop: StopCheck = StopCheck.NEVER,
        cancel: CancelHandle = CancelHandle(),
    ) = HttpUploadApi(HttpCore(testConfig(server), cancel, stop), session, { contacts.add(it) }, WO, ASSET)

    private fun problem(
        code: String,
        detail: String? = null,
    ): String {
        val errors = if (detail == null) "" else "{\"code\":\"$detail\"}"
        return "{\"code\":\"$code\",\"errors\":[$errors]}"
    }

    private fun failure(block: () -> Unit): Failure = assertThrows(UploadFailure::class.java) { block() }.failure

    // ---- the four calls of the upload

    @Test
    fun `EVM-130 AC1 createSession sends the session id and the idempotency key to the right path with the access token`() {
        val server =
            server {
                Reply(
                    201,
                    """{"id":"$SESSION","mediaAssetId":"$ASSET","state":"active","partSize":16777216,"partCount":3,"expiresAt":"x"}""",
                )
            }
        val info = api(server).createSession(ASSET, SESSION, KEY)
        assertEquals(SessionInfo(SESSION, 16_777_216L, 3), info)
        val seen = server.requests.single()
        assertEquals("POST", seen.method)
        assertEquals(BASE, seen.path)
        assertEquals("Bearer access-1", seen.headers["authorization"])
        assertEquals(KEY, seen.headers["idempotency-key"])
        assertEquals("android", seen.headers["x-client-platform"])
        assertEquals("1.2.3", seen.headers["x-client-version"])
        assertEquals("application/json", seen.headers["content-type"])
        assertEquals(mapOf("id" to SESSION), Json.obj(Json.parse(String(seen.body))))
        assertEquals(1, contacts.size)
        assertTrue(contacts.single() != null)
    }

    @Test
    fun `EVM-130 AC1 listParts, partUrl and complete read the contract answers`() {
        val server =
            server {
                when {
                    it.path.endsWith("/parts") -> Reply(200, """{"items":[{"partNumber":1,"size":16},{"partNumber":2,"size":8}]}""")

                    it.path.endsWith(
                        "/url",
                    ) -> Reply(200, """{"url":"https://store.example.test/p?X-Amz-Signature=sig","expiresAt":"x","contentLength":16}""")

                    else -> Reply(200, """{"id":"$ASSET","fileState":"scanning","stateReasonCode":null}""")
                }
            }
        val api = api(server)
        session.tokens = MutableList(3) { TokenResult.Ready("access-1", "u:d") }
        assertEquals(listOf(RemotePart(1, 16), RemotePart(2, 8)), api.listParts(SESSION))
        val url = api.partUrl(SESSION, 2)
        assertEquals(PartUrl("https://store.example.test/p?X-Amz-Signature=sig", 16).contentLength, url.contentLength)
        assertEquals("https://store.example.test/p?X-Amz-Signature=sig", url.url)
        assertEquals(FileState("scanning", null), api.complete(SESSION))
        assertEquals(
            listOf(
                "GET $BASE/$SESSION/parts",
                "GET $BASE/$SESSION/parts/2/url",
                "POST $BASE/$SESSION/complete",
            ),
            server.requests.map {
                "${it.method} ${it.path}"
            },
        )
        assertEquals("0", server.requests.last().headers["content-length"])
    }

    @Test
    fun `EVM-130 AC1 complete reads a reason code of the file state`() {
        val server = server { Reply(200, """{"fileState":"failed","stateReasonCode":"checksum_mismatch"}""") }
        assertEquals(FileState("failed", "checksum_mismatch"), api(server).complete(SESSION))
    }

    @Test
    fun `EVM-130 AC1 an answer that does not fit the contract is an unknown failure of its status, never a crash`() {
        val bodies =
            listOf(
                "not json",
                "[]",
                """{"id":"$SESSION"}""",
                """{"id":"$SESSION","partSize":"big","partCount":3}""",
                """{"id":"$SESSION","partSize":16,"partCount":0}""",
                """{"id":"$SESSION","partSize":16,"partCount":1001}""",
                """{"partSize":16,"partCount":3}""",
            )
        for (body in bodies) {
            session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
            val server = server { Reply(200, body) }
            assertEquals(Failure.Http(200), failure { api(server).createSession(ASSET, SESSION, KEY) }, body)
        }
        val listBodies =
            listOf(
                "{}",
                """{"items":"x"}""",
                """{"items":[1]}""",
                """{"items":[{"partNumber":"1","size":2}]}""",
                """{"items":[{"partNumber":1,"size":"2"}]}""",
                """{"items":[${(1..1001).joinToString(",") { """{"partNumber":1,"size":1}""" }}]}""",
            )
        for (body in listBodies) {
            session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
            val server = server { Reply(200, body) }
            assertEquals(Failure.Http(200), failure { api(server).listParts(SESSION) }, body.take(30))
        }
        for (body in listOf("{}", """{"url":""}""", """{"url":"https://x.test/"}""", "[]")) {
            session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
            val server = server { Reply(200, body) }
            assertEquals(Failure.Http(200), failure { api(server).partUrl(SESSION, 1) }, body)
        }
        for (body in listOf("{}", "[]", """{"fileState":5}""")) {
            session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
            val server = server { Reply(200, body) }
            assertEquals(Failure.Http(200), failure { api(server).complete(SESSION) }, body)
        }
        assertTrue(contacts.size >= 10)
    }

    // ---- identifiers

    @Test
    fun `EVM-130 AC3 an identifier that goes into a path is checked, and nothing is sent for a bad one`() {
        val server = server { Reply(200, "{}") }
        assertThrows(IllegalArgumentException::class.java) {
            HttpUploadApi(HttpCore(testConfig(server), CancelHandle(), StopCheck.NEVER), session, ContactSinkNone, "../x", ASSET)
        }
        assertThrows(IllegalArgumentException::class.java) {
            HttpUploadApi(HttpCore(testConfig(server), CancelHandle(), StopCheck.NEVER), session, ContactSinkNone, WO, "a/b")
        }
        val api = api(server)
        assertEquals(Failure.Http(400), failure { api.listParts("../../etc") })
        assertEquals(Failure.Http(400), failure { api.createSession(ASSET, "a b", KEY) })
        assertEquals(Failure.Http(400), failure { api.createSession(ASSET, SESSION, "a\nb") })
        assertThrows(IllegalArgumentException::class.java) { api.partUrl(SESSION, 0) }
        assertThrows(IllegalArgumentException::class.java) { api.partUrl(SESSION, 1001) }
        assertTrue(server.requests.isEmpty())
    }

    // ---- the answers of the server

    @Test
    fun `EVM-130 AC2 a plain 401 refreshes the access token once and repeats the call once with the new one`() {
        var calls = 0
        val server = server { if (calls++ == 0) Reply(401, problem("unauthenticated")) else Reply(200, """{"items":[]}""") }
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"), TokenResult.Ready("access-2", "u:d"))
        assertEquals(emptyList<RemotePart>(), api(server).listParts(SESSION))
        assertEquals(listOf("Bearer access-1", "Bearer access-2"), server.requests.map { it.headers["authorization"] })
        assertEquals(listOf("token", "rejected:access-1"), session.events)
    }

    @Test
    fun `EVM-130 AC2 a second plain 401 is a 401 with its code, and a refresh that fails is the failure the engine understands`() {
        val server = server { Reply(401, problem("unauthenticated")) }
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"), TokenResult.Ready("access-2", "u:d"))
        assertEquals(Failure.Http(401, "unauthenticated"), failure { api(server).listParts(SESSION) })
        assertEquals(2, server.requests.size)
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"), TokenResult.Blocked(SessionState.PAUSED_REVOKED))
        assertEquals(Failure.Http(401, "session_revoked"), failure { api(server).listParts(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"), TokenResult.RetryLater)
        assertEquals(Failure.Network, failure { api(server).listParts(SESSION) })
    }

    @Test
    fun `EVM-130 AC5 401 session_revoked and device_wipe_required tell the owner at once and are the failures of the engine`() {
        val revoked = server { Reply(401, problem("session_revoked")) }
        assertEquals(Failure.Http(401, "session_revoked"), failure { api(revoked).listParts(SESSION) })
        assertEquals(listOf("token", "revoked"), session.events)
        session.events.clear()
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val wipe = server { Reply(401, problem("device_wipe_required")) }
        assertEquals(Failure.Http(401, "device_wipe_required"), failure { api(wipe).listParts(SESSION) })
        assertEquals(listOf("token", "wipe"), session.events)
        assertEquals(1, wipe.requests.size)
    }

    @Test
    fun `EVM-130 AC5 426 tells the owner that the work waits for an update`() {
        val server = server { Reply(426, problem("client_version_unsupported")) }
        assertEquals(Failure.Http(426, "client_version_unsupported"), failure { api(server).listParts(SESSION) })
        assertEquals(listOf("token", "update"), session.events)
    }

    @Test
    fun `EVM-130 AC2 429 carries Retry-After, other statuses carry their top-level code, and no failure counts as a contact`() {
        val limited = server { Reply(429, problem("rate_limited"), mapOf("Retry-After" to "7")) }
        assertEquals(Failure.Http(429, "rate_limited", 7L), failure { api(limited).listParts(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val unavailable = server { Reply(503, problem("media_storage_unavailable"), mapOf("Retry-After" to "9")) }
        assertEquals(Failure.Http(503, "media_storage_unavailable"), failure { api(unavailable).listParts(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val empty = server { Reply(500) }
        assertEquals(Failure.Http(500), failure { api(empty).listParts(SESSION) })
        assertTrue(contacts.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 the code of the top level decides, the detail of errors is only a detail`() {
        val incomplete = server { Reply(422, problem("upload_incomplete", "size_mismatch")) }
        assertEquals(Failure.Http(422, "upload_incomplete"), failure { api(incomplete).complete(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val mismatch = server { Reply(422, problem("idempotency_mismatch", "size_mismatch")) }
        assertEquals(Failure.Http(422, "idempotency_mismatch"), failure { api(mismatch).complete(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val detailOnly = server { Reply(422, """{"errors":[{"code":"size_mismatch"}]}""") }
        assertEquals(Failure.Http(422), failure { api(detailOnly).complete(SESSION) })
        session.tokens = mutableListOf(TokenResult.Ready("access-1", "u:d"))
        val weird = server { Reply(409, """{"code":"Bad Code!"}""") }
        assertEquals(Failure.Http(409), failure { api(weird).complete(SESSION) })
    }

    @Test
    fun `EVM-130 AC2 a session that is not usable gives the failure of the engine and sends no request`() {
        val server = server { Reply(200, "{}") }
        val cases =
            mapOf(
                SessionState.PAUSED_REVOKED to Failure.Http(401, "session_revoked"),
                SessionState.NEEDS_LOGIN to Failure.Http(401, "session_revoked"),
                SessionState.SIGNED_OUT to Failure.Http(401, "session_revoked"),
                SessionState.WIPE_REQUIRED to Failure.Http(401, "device_wipe_required"),
                SessionState.PAUSED_UPDATE to Failure.Http(426, "client_version_unsupported"),
            )
        for ((state, expected) in cases) {
            session.tokens = mutableListOf(TokenResult.Blocked(state))
            assertEquals(expected, failure { api(server).listParts(SESSION) }, state.name)
        }
        session.tokens = mutableListOf(TokenResult.RetryLater)
        assertEquals(Failure.Network, failure { api(server).listParts(SESSION) })
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 the API does not follow a redirect and the access token goes nowhere else`() {
        val elsewhere = server { Reply(200, "{}") }
        val api = server { Reply(307, "", mapOf("Location" to "${elsewhere.origin}/steal")) }
        assertEquals(Failure.Http(307), failure { api(api).listParts(SESSION) })
        assertTrue(elsewhere.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 a cancel is never a network failure - it passes through the adapter, with a closed connection too`() {
        val server = server { Reply(200, "{}") }
        val cancel = CancelHandle()
        cancel.cancel()
        session.tokens = MutableList(2) { TokenResult.Ready("access-1", "u:d") }
        assertThrows(UploadCancelledException::class.java) { api(server, cancel = cancel).listParts(SESSION) }
        assertThrows(UploadCancelledException::class.java) { api(server, stop = { true }).listParts(SESSION) }
        assertTrue(server.requests.isEmpty())
    }

    // ---- the session calls

    private val refreshBody =
        """{"deviceId":"d","accessToken":"access-new","accessTokenExpiresAt":"2026-10-27T08:30:00Z","refreshToken":"refresh-new","refreshTokenExpiresAt":"2026-11-10T08:15:00Z","serverTime":"2026-10-27T08:15:00Z","user":{"id":"u"}}"""

    private fun auth(server: TestServer) = HttpAuthApi(HttpCore(testConfig(server), CancelHandle(), StopCheck.NEVER))

    @Test
    fun `EVM-130 AC2 a refresh sends the token in the body only, and counts the life of the access token in the frame of the server`() {
        val server = server { Reply(200, refreshBody) }
        val answer = auth(server).refresh("refresh-old")
        assertEquals(
            RefreshAnswer.Success(
                "access-new",
                900_000L,
                "refresh-new",
                java.time.Instant
                    .parse("2026-10-27T08:15:00Z")
                    .toEpochMilli(),
            ),
            answer,
        )
        val seen = server.requests.single()
        assertEquals("/api/v1/auth/mobile/token", seen.path)
        assertEquals(mapOf("refreshToken" to "refresh-old"), Json.obj(Json.parse(String(seen.body))))
        assertNull(seen.headers["authorization"])
        assertTrue(!seen.path.contains("refresh-old") && seen.headers.values.none { it.contains("refresh-old") })
        assertEquals("android", seen.headers["x-client-platform"])
    }

    @Test
    fun `EVM-130 AC2 the answers of a refresh map to what the owner needs`() {
        val cases =
            listOf(
                Reply(401, problem("session_revoked")) to RefreshAnswer.Revoked,
                Reply(401, problem("device_wipe_required")) to RefreshAnswer.WipeRequired,
                Reply(401, "{}") to RefreshAnswer.Revoked,
                Reply(403, problem("forbidden")) to RefreshAnswer.Forbidden,
                Reply(426, problem("client_version_unsupported")) to RefreshAnswer.UpdateRequired,
                Reply(429, problem("rate_limited"), mapOf("Retry-After" to "5")) to RefreshAnswer.NoAnswer,
                Reply(500) to RefreshAnswer.NoAnswer,
                Reply(400, problem("validation_failed")) to RefreshAnswer.NoAnswer,
            )
        for ((reply, expected) in cases) {
            assertEquals(expected, auth(server { reply }).refresh("refresh-old"), reply.status.toString())
        }
    }

    @Test
    fun `EVM-130 AC2 a 200 that is not a session is no answer - the token may have been used`() {
        val bodies =
            listOf(
                "not json",
                "[]",
                refreshBody.replace("access-new", ""),
                refreshBody.replace("\"refresh-new\"", "5"),
                refreshBody.replace("access-new", "x".repeat(5000)),
                refreshBody.replace("2026-10-27T08:15:00Z", "yesterday"),
                refreshBody.replace("2026-10-27T08:30:00Z", "2026-10-27T08:15:00Z"),
                refreshBody.replace("2026-10-27T08:30:00Z", "2026-10-27T08:00:00Z"),
                refreshBody.replace("\"accessTokenExpiresAt\":\"2026-10-27T08:30:00Z\",", ""),
            )
        for (body in bodies) assertEquals(RefreshAnswer.NoAnswer, auth(server { Reply(200, body) }).refresh("refresh-old"), body.take(60))
    }

    @Test
    fun `EVM-130 AC2 a failure before the first byte leaves the token untouched, a failure after it is no answer`() {
        val dead = TestServer()
        val port = dead.port
        dead.close()
        val config = HttpConfig("http://127.0.0.1:$port", listOf("127.0.0.1:$port"), "1.0.0", true, 1000, 1000)
        assertEquals(RefreshAnswer.NotSent, HttpAuthApi(HttpCore(config, CancelHandle(), StopCheck.NEVER)).refresh("refresh-old"))
        val slow =
            server {
                Thread.sleep(1500)
                Reply(200, refreshBody)
            }
        val impatient = HttpConfig(slow.origin, listOf(slow.authority), "1.0.0", true, 1000, 300)
        assertEquals(RefreshAnswer.NoAnswer, HttpAuthApi(HttpCore(impatient, CancelHandle(), StopCheck.NEVER)).refresh("refresh-old"))
    }

    @Test
    fun `EVM-130 AC2 a refresh that is stopped is a cancel and keeps its token in the owner's window`() {
        val server = server { Reply(200, refreshBody) }
        val cancel = CancelHandle().also { it.cancel() }
        assertThrows(UploadCancelledException::class.java) {
            HttpAuthApi(HttpCore(testConfig(server), cancel, StopCheck.NEVER)).refresh("refresh-old")
        }
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 a logout sends the access token to the API only, and maps the answer`() {
        val done = server { Reply(204) }
        assertEquals(LogoutAnswer.DONE, auth(done).logout("access-1"))
        assertEquals("/api/v1/auth/mobile/logout", done.requests.single().path)
        assertEquals("Bearer access-1", done.requests.single().headers["authorization"])
        for ((status, expected) in listOf(
            200 to LogoutAnswer.DONE,
            401 to LogoutAnswer.ALREADY_ENDED,
            403 to LogoutAnswer.ALREADY_ENDED,
            429 to LogoutAnswer.UNAVAILABLE,
            426 to LogoutAnswer.UNAVAILABLE,
            500 to LogoutAnswer.UNAVAILABLE,
        )) {
            assertEquals(expected, auth(server { Reply(status) }).logout("access-1"), status.toString())
        }
        val dead = TestServer()
        val config = testConfig(dead)
        dead.close()
        assertEquals(LogoutAnswer.UNAVAILABLE, HttpAuthApi(HttpCore(config, CancelHandle(), StopCheck.NEVER)).logout("access-1"))
    }

    @Test
    fun `EVM-130 AC3 the refresh and the logout do not follow a redirect either`() {
        val elsewhere = server { Reply(200, refreshBody) }
        val redirecting = server { Reply(307, "", mapOf("Location" to "${elsewhere.origin}/x")) }
        assertEquals(RefreshAnswer.NoAnswer, auth(redirecting).refresh("refresh-old"))
        assertEquals(LogoutAnswer.UNAVAILABLE, auth(redirecting).logout("access-1"))
        assertTrue(elsewhere.requests.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 the time of an answer is read without java time, with fractions, leap years and bad dates refused`() {
        assertEquals(
            java.time.Instant
                .parse("2026-10-27T08:15:00Z")
                .toEpochMilli(),
            Iso8601.parse("2026-10-27T08:15:00Z"),
        )
        assertEquals(
            java.time.Instant
                .parse("2024-02-29T23:59:59.123456789Z")
                .toEpochMilli(),
            Iso8601.parse("2024-02-29T23:59:59.123456789Z"),
        )
        assertEquals(
            java.time.Instant
                .parse("1969-12-31T23:59:59.5Z")
                .toEpochMilli(),
            Iso8601.parse("1969-12-31T23:59:59.5Z"),
        )
        assertEquals(
            java.time.Instant
                .parse("2000-02-29T00:00:00Z")
                .toEpochMilli(),
            Iso8601.parse("2000-02-29T00:00:00Z"),
        )
        assertEquals(
            java.time.Instant
                .parse("0001-01-01T00:00:00Z")
                .toEpochMilli(),
            Iso8601.parse("0001-01-01T00:00:00Z"),
        )
        assertEquals(
            java.time.Instant
                .parse("0000-02-10T00:00:00Z")
                .toEpochMilli(),
            Iso8601.parse("0000-02-10T00:00:00Z"),
        )
        for (month in 1..12) {
            val last =
                java.time.YearMonth
                    .of(2026, month)
                    .lengthOfMonth()
            val text = "2026-%02d-%02dT12:00:00Z".format(month, last)
            assertEquals(
                java.time.Instant
                    .parse(text)
                    .toEpochMilli(),
                Iso8601.parse(text),
                text,
            )
            assertNull(Iso8601.parse("2026-%02d-%02dT12:00:00Z".format(month, last + 1)), month.toString())
        }
        for (bad in listOf(
            null,
            "",
            "2026-10-27 08:15:00Z",
            "2026-10-27T08:15:00+02:00",
            "2023-02-29T00:00:00Z",
            "2100-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-00-10T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2026-10-27T24:00:00Z",
            "2026-10-27T08:60:00Z",
            "2026-10-27T08:15:60Z",
        )) {
            assertNull(Iso8601.parse(bad), bad.toString())
        }
    }
}

private val ContactSinkNone = pl.eviacharge.upload.files.ContactSink.NONE
