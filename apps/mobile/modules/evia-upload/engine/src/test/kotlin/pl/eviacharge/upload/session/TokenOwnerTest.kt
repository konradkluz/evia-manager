package pl.eviacharge.upload.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.files.ContactSink
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val OWNER = "user-1:device-1"

internal class MemoryVault(
    var content: VaultRead = VaultRead.Empty,
    var failWrites: Int = 0,
    var failClears: Int = 0,
) : TokenVault {
    val events = mutableListOf<String>()
    val record: TokenRecord? get() = (content as? VaultRead.Found)?.record

    override fun read(): VaultRead = content

    override fun write(record: TokenRecord) {
        if (failWrites > 0) {
            failWrites -= 1
            throw IOException("disk full")
        }
        events.add("write:${record.session?.refreshToken}|${record.pendingRevocations.joinToString(",")}")
        content = VaultRead.Found(record)
    }

    override fun clear() {
        if (failClears > 0) {
            failClears -= 1
            throw IOException("cannot delete")
        }
        events.add("clear")
        content = VaultRead.Empty
    }
}

private class FakeClock(
    var now: Long = 1_000_000L,
) : MonotonicClock {
    override fun nowMs(): Long = now
}

private class ScriptedApi(
    private val answers: MutableList<RefreshAnswer>,
    private val onCall: (String) -> Unit = {},
) : RefreshApi {
    val tokens = mutableListOf<String>()

    override fun refresh(refreshToken: String): RefreshAnswer {
        tokens.add(refreshToken)
        onCall(refreshToken)
        return answers.removeAt(0)
    }
}

private class ScriptedLogout(
    private val answers: MutableList<LogoutAnswer> = mutableListOf(),
    private val fail: RuntimeException? = null,
) : LogoutApi {
    val tokens = mutableListOf<String>()

    override fun logout(accessToken: String): LogoutAnswer {
        tokens.add(accessToken)
        fail?.let { throw it }
        return if (answers.isEmpty()) LogoutAnswer.UNAVAILABLE else answers.removeAt(0)
    }
}

private fun success(n: Int) = RefreshAnswer.Success("access-$n", 900_000L, "refresh-$n", 5_000L + n)

private fun pendingOf(vault: MemoryVault) = vault.record?.pendingRevocations.orEmpty()

/** EVM-130 AC2, AC3, AC5: the native owner of the tokens. Each test names the Jest test of `session-owner.test.ts` it replaces. */
class TokenOwnerTest {
    private val vault = MemoryVault()
    private val clock = FakeClock()
    private val contacts = mutableListOf<Long?>()
    private val logout = ScriptedLogout()

    private fun owner(
        vararg answers: RefreshAnswer,
        logoutApi: LogoutApi = logout,
    ): Pair<TokenOwner, ScriptedApi> {
        val api = ScriptedApi(answers.toMutableList())
        return TokenOwner(vault, api, clock, logoutApi, { contacts.add(it) }) to api
    }

    private fun signedIn(vararg answers: RefreshAnswer): Pair<TokenOwner, ScriptedApi> {
        val (tokenOwner, api) = owner(*answers)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        return tokenOwner to api
    }

    // ---- sign-in (JS: sign-in commit, EVM-100 AC1)

    @Test
    fun `EVM-130 AC3 the sign-in stores the refresh token once, keeps the access token in memory only, and serves it without a refresh`() {
        val (tokenOwner, api) = signedIn()
        assertEquals(listOf("write:refresh-0|"), vault.events)
        assertEquals(TokenResult.Ready("access-0", OWNER), tokenOwner.accessToken())
        assertTrue(api.tokens.isEmpty())
        assertTrue(tokenOwner.mayWork(OWNER))
        assertFalse(tokenOwner.mayWork("someone-else"))
        assertEquals(OWNER, tokenOwner.currentOwnerId())
        assertFalse(vault.record.toString().contains("access-0"))
        assertEquals(listOf<Long?>(null), contacts)
    }

    @Test
    fun `EVM-130 AC3 a sign-in that cannot be stored fails visibly, the new session is ended on the server and nothing is signed in`() {
        val (tokenOwner, _) = owner()
        vault.failWrites = 1
        assertThrows(IOException::class.java) { tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L) }
        assertEquals(SessionState.SIGNED_OUT, tokenOwner.state())
        assertNull(tokenOwner.currentOwnerId())
        assertEquals(listOf("access-0"), logout.tokens)
        // the server could not be asked (no answer): the refresh token is kept only as a pending revocation
        assertEquals(listOf("refresh-0"), pendingOf(vault))
        assertNull(vault.record?.session)
    }

    @Test
    fun `EVM-130 AC3 a sign-in that cannot be stored and is ended on the server leaves no token at all`() {
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, _) = owner(logoutApi = ended)
        vault.failWrites = 1
        assertThrows(IOException::class.java) { tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L) }
        assertEquals(VaultRead.Empty, vault.content)
    }

    @Test
    fun `EVM-130 AC3 the staged sign-in of the device check lives in memory only, until it is committed`() {
        val (tokenOwner, _) = owner()
        tokenOwner.stageLogin(OWNER, "refresh-0", "access-0", 900_000L, 7L)
        assertEquals(VaultRead.Empty, vault.content)
        assertEquals(SessionState.SIGNED_OUT, tokenOwner.state())
        tokenOwner.commitStaged()
        assertEquals("refresh-0", vault.record?.session?.refreshToken)
        assertEquals(TokenResult.Ready("access-0", OWNER), tokenOwner.accessToken())
        assertEquals(listOf<Long?>(7L), contacts)
        assertThrows(IllegalStateException::class.java) { tokenOwner.commitStaged() }
    }

    @Test
    fun `EVM-130 AC3 abandoning the device check ends the staged session on the server at once, nothing is stored`() {
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, _) = owner(logoutApi = ended)
        tokenOwner.stageLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.abandonStaged()
        assertEquals(listOf("access-0"), ended.tokens)
        assertEquals(VaultRead.Empty, vault.content)
        tokenOwner.abandonStaged()
        assertEquals(1, ended.tokens.size)
    }

    @Test
    fun `EVM-130 AC3 abandoning without a staged session sends nothing`() {
        val (tokenOwner, _) = owner()
        tokenOwner.abandonStaged()
        assertTrue(logout.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 an abandoned session that the server cannot be asked about becomes a pending revocation, and an ended one does not`() {
        val (offline, _) = owner()
        offline.stageLogin(OWNER, "refresh-0", "access-0", 900_000L)
        offline.abandonStaged()
        assertEquals(listOf("refresh-0"), pendingOf(vault))
        val gone = ScriptedLogout(mutableListOf(LogoutAnswer.ALREADY_ENDED))
        val vault2 = MemoryVault()
        val second = TokenOwner(vault2, ScriptedApi(mutableListOf()), clock, gone)
        second.stageLogin(OWNER, "refresh-1", "access-1", 900_000L)
        second.abandonStaged()
        assertEquals(VaultRead.Empty, vault2.content)
    }

    @Test
    fun `EVM-130 AC3 a pending revocation that cannot be stored does not break the abandon, and a failing logout call is no network`() {
        val (tokenOwner, _) = owner()
        tokenOwner.stageLogin(OWNER, "refresh-0", "access-0", 900_000L)
        vault.failWrites = 1
        tokenOwner.abandonStaged()
        assertEquals(VaultRead.Empty, vault.content)
        // the list in memory is the truth of this process: the next change writes it
        tokenOwner.commitLogin(OWNER, "refresh-1", "access-1", 900_000L)
        assertEquals(listOf("refresh-0"), pendingOf(vault))
    }

    @Test
    fun `EVM-130 AC3 a second staged sign-in ends the first one, and an interrupted logout call keeps the token for later`() {
        val (tokenOwner, _) = owner()
        tokenOwner.stageLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.stageLogin(OWNER, "refresh-1", "access-1", 900_000L)
        assertEquals(listOf("access-0"), logout.tokens)
        assertEquals(listOf("refresh-0"), pendingOf(vault))
        val interrupted = ScriptedLogout(fail = UploadCancelledException())
        val vault2 = MemoryVault()
        val stopped = TokenOwner(vault2, ScriptedApi(mutableListOf()), clock, interrupted)
        stopped.stageLogin(OWNER, "refresh-2", "access-2", 900_000L)
        assertThrows(UploadCancelledException::class.java) { stopped.abandonStaged() }
        assertEquals(listOf("refresh-2"), pendingOf(vault2))
    }

    // ---- start of the process (JS: start of the app, EVM-100 AC6, AC1)

    @Test
    fun `EVM-130 AC3 load restores the session without any request and a refresh happens only when an access token is asked for`() {
        vault.content = VaultRead.Found(TokenRecord(StoredSession(OWNER, "refresh-7"), listOf("old-1")))
        val (restored, api) = owner(success(8))
        assertEquals(SessionState.SIGNED_IN, restored.load())
        assertTrue(api.tokens.isEmpty())
        assertEquals(TokenResult.Ready("access-8", OWNER), restored.accessToken())
        assertEquals(listOf("refresh-7"), api.tokens)
        assertEquals(listOf("old-1"), pendingOf(vault))
    }

    @Test
    fun `EVM-130 AC3 load treats nothing stored as signed out and an unreadable record as a new sign-in, without a crash`() {
        val (empty, _) = owner()
        assertEquals(SessionState.SIGNED_OUT, empty.load())
        assertEquals(TokenResult.Blocked(SessionState.SIGNED_OUT), empty.accessToken())
        vault.content = VaultRead.Unreadable
        val (broken, api) = owner()
        assertEquals(SessionState.NEEDS_LOGIN, broken.load())
        assertEquals(TokenResult.Blocked(SessionState.NEEDS_LOGIN), broken.accessToken())
        assertTrue(api.tokens.isEmpty())
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
        val (leftover, _) = owner()
        assertEquals(SessionState.SIGNED_OUT, leftover.load())
        assertNull(leftover.currentOwnerId())
    }

    // ---- refresh (JS: refresh, EVM-100 AC5)

    @Test
    fun `EVM-130 AC2 the new refresh token is stored before the new access token is used`() {
        val (tokenOwner, _) = signedIn(success(1))
        clock.now += 900_000L
        val result = tokenOwner.accessToken()
        assertEquals(TokenResult.Ready("access-1", OWNER), result)
        assertEquals(listOf("write:refresh-0|", "write:refresh-1|"), vault.events)
        assertEquals("refresh-1", vault.record?.session?.refreshToken)
        assertEquals(5_001L, contacts.last())
    }

    @Test
    fun `EVM-130 AC2 an access token about to expire is refreshed before use`() {
        val (tokenOwner, api) = signedIn(success(1))
        clock.now += 900_000L - TokenOwner.SKEW_MS + 1
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessToken())
        assertEquals(1, api.tokens.size)
    }

    @Test
    fun `EVM-130 AC2 a token that cannot be stored is not used, the next call stores it from memory without a second refresh`() {
        val (tokenOwner, api) = signedIn(success(1))
        clock.now += 900_000L
        vault.failWrites = 1
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        assertEquals("refresh-0", vault.record?.session?.refreshToken)
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessToken())
        assertEquals("refresh-1", vault.record?.session?.refreshToken)
        assertEquals(1, api.tokens.size)
        // a failure that lasts keeps withholding the access token and does not refresh again
        val (stubborn, other) = signedIn(success(2))
        clock.now += 900_000L
        vault.failWrites = 2
        assertEquals(TokenResult.RetryLater, stubborn.accessToken())
        assertEquals(TokenResult.RetryLater, stubborn.accessToken())
        assertEquals(TokenResult.Ready("access-2", OWNER), stubborn.accessToken())
        assertEquals(1, other.tokens.size)
    }

    @Test
    fun `EVM-130 AC2 an error before the request is sent leaves the token untouched, and the retry sends the same token`() {
        val (tokenOwner, api) = signedIn(RefreshAnswer.NotSent, RefreshAnswer.NotSent, success(1))
        clock.now += 900_000L
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        clock.now += 60_000L
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessToken())
        assertEquals(listOf("refresh-0", "refresh-0", "refresh-0"), api.tokens)
        assertEquals(listOf("write:refresh-0|", "write:refresh-1|"), vault.events)
    }

    @Test
    fun `EVM-130 AC2 a sent request without an answer is retried with the same token within 20 s, then a new sign-in is needed`() {
        val (tokenOwner, api) = signedIn(RefreshAnswer.NoAnswer, RefreshAnswer.NoAnswer, success(1))
        clock.now += 900_000L
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        clock.now += TokenOwner.WINDOW_MS
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        assertEquals(listOf("refresh-0", "refresh-0"), api.tokens)
        clock.now += 1
        assertEquals(TokenResult.Blocked(SessionState.NEEDS_LOGIN), tokenOwner.accessToken())
        assertEquals(2, api.tokens.size)
        assertEquals(SessionState.NEEDS_LOGIN, tokenOwner.state())
    }

    @Test
    fun `EVM-130 AC2 the window is measured by the monotonic clock only, not by the wall clock`() {
        val wall = System.currentTimeMillis()
        val (tokenOwner, api) = signedIn(RefreshAnswer.NoAnswer, success(1))
        clock.now += 900_000L
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        // the wall clock may jump anywhere: only the injected monotonic clock counts
        clock.now += 5_000L
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessToken())
        assertEquals(2, api.tokens.size)
        assertTrue(System.currentTimeMillis() >= wall)
    }

    @Test
    fun `EVM-130 AC2 a 403 or a 426 while refreshing signs nobody out, and an interrupted refresh keeps the window of the sent token`() {
        val (tokenOwner, api) = signedIn(RefreshAnswer.Forbidden, RefreshAnswer.UpdateRequired)
        clock.now += 900_000L
        assertEquals(TokenResult.RetryLater, tokenOwner.accessToken())
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_UPDATE), tokenOwner.accessToken())
        assertEquals("refresh-0", vault.record?.session?.refreshToken)
        assertFalse(tokenOwner.mayWork(OWNER))
        assertEquals(2, api.tokens.size)
        val interrupting = TokenOwner(MemoryVault(), RefreshApi { throw UploadCancelledException() }, clock, logout)
        interrupting.commitLogin(OWNER, "refresh-0", "access-0", 1000L)
        clock.now += 10_000L
        assertThrows(UploadCancelledException::class.java) { interrupting.accessToken() }
        assertThrows(UploadCancelledException::class.java) { interrupting.accessToken() }
        clock.now += TokenOwner.WINDOW_MS + 1
        assertEquals(TokenResult.Blocked(SessionState.NEEDS_LOGIN), interrupting.accessToken())
    }

    @Test
    fun `EVM-130 AC2 the foreground app and the job share one refresh (single flight)`() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val api =
            RefreshApi {
                calls.incrementAndGet()
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
                success(1)
            }
        val tokenOwner = TokenOwner(vault, api, clock, logout)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L)
        clock.now += 10_000L
        val pool = Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit<TokenResult> { tokenOwner.accessToken() }
            started.await(5, TimeUnit.SECONDS)
            val second = pool.submit<TokenResult> { tokenOwner.accessToken() }
            release.countDown()
            assertEquals(TokenResult.Ready("access-1", OWNER), first.get(5, TimeUnit.SECONDS))
            assertEquals(TokenResult.Ready("access-1", OWNER), second.get(5, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, calls.get())
    }

    @Test
    fun `EVM-130 AC2 a token the server refused is refreshed unless somebody has already refreshed it`() {
        val (tokenOwner, api) = signedIn(success(1))
        // somebody else holds a newer token already: no second refresh
        assertEquals(TokenResult.Ready("access-0", OWNER), tokenOwner.accessTokenRejected("stale-token"))
        assertTrue(api.tokens.isEmpty())
        // the held token itself was refused: it is dropped and refreshed
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessTokenRejected("access-0"))
        assertEquals(1, api.tokens.size)
        assertEquals(TokenResult.Blocked(SessionState.SIGNED_OUT), owner().first.accessTokenRejected("x"))
    }

    // ---- the end of a session (JS: session_revoked, device_wipe_required)

    @Test
    fun `EVM-130 AC2 session_revoked pauses the work, drops both tokens at once and a full sign-in of the same owner resumes it`() {
        val (tokenOwner, _) = signedIn(RefreshAnswer.Revoked)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_REVOKED), tokenOwner.accessToken())
        assertEquals(TokenRecord(null, emptyList(), EndedBy.REVOKED), vault.record)
        assertFalse(tokenOwner.mayWork(OWNER))
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_REVOKED), tokenOwner.accessTokenRejected("access-0"))
        // another person signing in does not resume the paused work of the first owner
        tokenOwner.commitLogin("user-2:device-1", "refresh-9", "access-9", 900_000L)
        assertFalse(tokenOwner.mayWork(OWNER))
        assertTrue(tokenOwner.mayWork("user-2:device-1"))
        // the same owner after a full sign-in resumes it
        tokenOwner.commitLogin(OWNER, "refresh-10", "access-10", 900_000L)
        assertTrue(tokenOwner.mayWork(OWNER))
    }

    @Test
    fun `EVM-130 AC2 session_revoked reported by the API removes the tokens atomically, zero requests with the old token`() {
        val (tokenOwner, api) = signedIn()
        val oldAccess = (tokenOwner.accessToken() as TokenResult.Ready).accessToken
        tokenOwner.onApiRevoked()
        assertEquals(SessionState.PAUSED_REVOKED, tokenOwner.state())
        assertEquals(TokenRecord(null, emptyList(), EndedBy.REVOKED), vault.record)
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_REVOKED), tokenOwner.accessToken())
        assertTrue(oldAccess !in (tokenOwner.accessToken() as TokenResult.Blocked).toString())
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC2 an ending session keeps the pending revocations and removes the session even when the store cannot be written`() {
        vault.content = VaultRead.Found(TokenRecord(StoredSession(OWNER, "refresh-0"), listOf("old-1")))
        val (tokenOwner, _) = owner()
        tokenOwner.load()
        vault.failWrites = 1
        tokenOwner.onApiRevoked()
        // the new record could not be written: the old one (with the session) is removed instead
        assertEquals(VaultRead.Empty, vault.content)
        vault.content = VaultRead.Found(TokenRecord(StoredSession(OWNER, "refresh-0"), listOf("old-1")))
        val (second, _) = owner()
        second.load()
        second.onApiRevoked()
        assertEquals(TokenRecord(null, listOf("old-1"), EndedBy.REVOKED), vault.record)
        vault.failWrites = 1
        vault.failClears = 1
        second.onApiWipeRequired()
        assertEquals(SessionState.WIPE_REQUIRED, second.state())
    }

    @Test
    fun `EVM-130 AC5 a session ended by the server stays ended after process death - revoked, wipe order from API or refresh`() {
        val cases =
            listOf<Pair<(TokenOwner) -> Unit, SessionState>>(
                { o: TokenOwner -> o.onApiRevoked() } to SessionState.PAUSED_REVOKED,
                { o: TokenOwner -> o.onApiWipeRequired() } to SessionState.WIPE_REQUIRED,
            )
        for ((end, expected) in cases) {
            val (first, _) = signedIn()
            end(first)
            val (restarted, api) = owner()
            assertEquals(expected, restarted.load())
            assertEquals(TokenResult.Blocked(expected), restarted.accessToken())
            assertNull(restarted.currentOwnerId())
            assertFalse(restarted.mayWork(OWNER))
            assertTrue(api.tokens.isEmpty())
        }
        for ((answer, expected) in listOf(
            RefreshAnswer.Revoked to SessionState.PAUSED_REVOKED,
            RefreshAnswer.WipeRequired to SessionState.WIPE_REQUIRED,
        )) {
            val (first, _) = signedIn(answer)
            clock.now += 900_000L
            assertEquals(TokenResult.Blocked(expected), first.accessToken())
            val (restarted, api) = owner()
            assertEquals(expected, restarted.load())
            assertEquals(TokenResult.Blocked(expected), restarted.accessToken())
            assertTrue(api.tokens.isEmpty())
        }
    }

    @Test
    fun `EVM-130 AC5 the ended state goes with a new sign-in, the sign-out and the finished wipe, never earlier`() {
        val (first, _) = signedIn()
        first.onApiRevoked()
        val (second, _) = owner()
        assertEquals(SessionState.PAUSED_REVOKED, second.load())
        second.commitLogin(OWNER, "refresh-5", "access-5", 900_000L)
        assertEquals(TokenRecord(StoredSession(OWNER, "refresh-5"), emptyList()), vault.record)
        assertEquals(SessionState.SIGNED_IN, owner().first.load())

        val (third, _) = signedIn()
        third.onApiWipeRequired()
        val (fourth, _) = owner()
        assertEquals(SessionState.WIPE_REQUIRED, fourth.load())
        fourth.wipe()
        assertEquals(VaultRead.Empty, vault.content)
        assertEquals(SessionState.SIGNED_OUT, owner().first.load())

        val (fifth, _) = signedIn()
        fifth.onApiRevoked()
        val (sixth, _) = owner()
        sixth.load()
        sixth.signOut(online = false)
        assertEquals(SessionState.SIGNED_OUT, owner().first.load())
    }

    @Test
    fun `EVM-130 AC5 device_wipe_required and 426 stop the work, the wipe and the sign-out remove the tokens`() {
        val (wiped, _) = signedIn(RefreshAnswer.WipeRequired)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.WIPE_REQUIRED), wiped.accessToken())
        assertEquals(TokenRecord(null, emptyList(), EndedBy.WIPE), vault.record)

        val (outdated, _) = signedIn(RefreshAnswer.UpdateRequired)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_UPDATE), outdated.accessToken())
        assertEquals("refresh-0", vault.record?.session?.refreshToken)
        assertFalse(outdated.mayWork(OWNER))

        val (api426, _) = signedIn()
        api426.onApiUpdateRequired()
        assertEquals(SessionState.PAUSED_UPDATE, api426.state())
        assertEquals("refresh-0", vault.record?.session?.refreshToken)

        val (forced, _) = signedIn()
        forced.wipe()
        assertEquals(TokenResult.Blocked(SessionState.WIPE_REQUIRED), forced.accessToken())
        assertEquals(VaultRead.Empty, vault.content)
    }

    @Test
    fun `EVM-130 AC5 the wipe clears memory and pending revocations even when the file cannot be removed`() {
        val (tokenOwner, _) = signedIn()
        tokenOwner.stageLogin(OWNER, "refresh-9", "access-9", 900_000L)
        vault.failClears = 1
        tokenOwner.wipe()
        assertEquals(SessionState.WIPE_REQUIRED, tokenOwner.state())
        assertNull(tokenOwner.currentOwnerId())
        assertThrows(IllegalStateException::class.java) { tokenOwner.commitStaged() }
    }

    @Test
    fun `EVM-130 AC3 after a sign-out the owner gives no token and asks nothing`() {
        val (tokenOwner, api) = owner()
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L)
        tokenOwner.onApiRevoked()
        tokenOwner.commitLogin(OWNER, "refresh-1", "access-1", 1000L)
        tokenOwner.signOut(online = false)
        assertEquals(TokenResult.Blocked(SessionState.SIGNED_OUT), tokenOwner.accessToken())
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 the refresh token never leaves the owner through the results`() {
        val (tokenOwner, _) = signedIn(success(1))
        clock.now += 900_000L
        val result = tokenOwner.accessToken()
        assertFalse(result.toString().contains("refresh-"))
        assertFalse(tokenOwner.state().toString().contains("refresh-"))
        assertFalse(tokenOwner.currentOwnerId().orEmpty().contains("refresh-"))
        // no method of the owner or of the port hands a token out: the only read paths return results without refresh tokens
        val declared =
            TokenOwner::class.java.declaredMethods.filter {
                java.lang.reflect.Modifier
                    .isPublic(it.modifiers)
            }
        assertTrue(declared.none { it.returnType == String::class.java && !it.name.contains("OwnerId") })
        assertTrue(declared.none { it.name.contains("refreshToken", ignoreCase = true) && it.parameterCount == 0 })
    }

    // ---- sign-out and the pending revocation (JS: EVM-100 AC7)

    @Test
    fun `EVM-130 AC3 online with a valid access token the sign-out asks the server, then tokens and record are gone`() {
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, api) = owner(logoutApi = ended)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.signOut(online = true)
        assertEquals(listOf("access-0"), ended.tokens)
        assertTrue(api.tokens.isEmpty())
        assertEquals(SessionState.SIGNED_OUT, tokenOwner.state())
        assertEquals(VaultRead.Empty, vault.content)
        assertEquals(TokenResult.Blocked(SessionState.SIGNED_OUT), tokenOwner.accessToken())
    }

    @Test
    fun `EVM-130 AC3 offline the refresh token becomes the pending revocation in the same write that ends the session`() {
        val (tokenOwner, api) = signedIn()
        vault.events.clear()
        tokenOwner.signOut(online = false)
        assertEquals(listOf("write:null|refresh-0"), vault.events)
        assertTrue(api.tokens.isEmpty())
        val (restarted, _) = owner()
        assertEquals(SessionState.SIGNED_OUT, restarted.load())
        assertNull(restarted.currentOwnerId())
    }

    @Test
    fun `EVM-130 AC3 when the network returns the pending token is refreshed, the rotated one stored BEFORE the logout, then removed`() {
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, api) = owner(success(1), logoutApi = ended)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.signOut(online = false)
        vault.events.clear()
        var seenBeforeLogout: List<String>? = null
        val spying =
            LogoutApi { token ->
                seenBeforeLogout = pendingOf(vault)
                ended.logout(token)
            }
        val (flusher, flushApi) = owner(success(1), logoutApi = spying)
        flusher.load()
        flusher.flushPendingRevocations()
        assertEquals(listOf("refresh-0"), flushApi.tokens)
        assertEquals(listOf("refresh-1"), seenBeforeLogout)
        assertEquals(VaultRead.Empty, vault.content)
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 401 or 403 at the refresh of a pending token removes it, while no network, 5xx, 429 and 426 keep it`() {
        for (answer in listOf(RefreshAnswer.Revoked, RefreshAnswer.WipeRequired, RefreshAnswer.Forbidden)) {
            vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
            val (flusher, _) = owner(answer)
            flusher.load()
            flusher.flushPendingRevocations()
            assertEquals(VaultRead.Empty, vault.content, answer.toString())
        }
        for (answer in listOf(RefreshAnswer.NotSent, RefreshAnswer.NoAnswer, RefreshAnswer.UpdateRequired)) {
            vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
            val (flusher, _) = owner(answer)
            flusher.load()
            flusher.flushPendingRevocations()
            assertEquals(listOf("old-1"), pendingOf(vault), answer.toString())
        }
    }

    @Test
    fun `EVM-130 AC3 a logout of the rotated pending token that gets 401 drops it, and one that gets no answer keeps the rotated token`() {
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
        val (dropping, _) = owner(success(1), logoutApi = ScriptedLogout(mutableListOf(LogoutAnswer.ALREADY_ENDED)))
        dropping.load()
        dropping.flushPendingRevocations()
        assertEquals(VaultRead.Empty, vault.content)
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
        val (keeping, _) = owner(success(2), logoutApi = ScriptedLogout(mutableListOf(LogoutAnswer.UNAVAILABLE)))
        keeping.load()
        keeping.flushPendingRevocations()
        assertEquals(listOf("refresh-2"), pendingOf(vault))
    }

    @Test
    fun `EVM-130 AC3 online without a valid access token the sign-out ends the server session through the revocation path`() {
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, api) = owner(success(1), logoutApi = ended)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L)
        clock.now += 900_000L
        tokenOwner.signOut(online = true)
        assertEquals(listOf("refresh-0"), api.tokens)
        assertEquals(listOf("access-1"), ended.tokens)
        assertEquals(VaultRead.Empty, vault.content)
    }

    @Test
    fun `EVM-130 AC3 an online logout that fails keeps the pending revocation, and a 401 at logout drops it`() {
        val (offline, _) = owner(logoutApi = ScriptedLogout(mutableListOf(LogoutAnswer.UNAVAILABLE)))
        offline.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        offline.signOut(online = true)
        assertEquals(listOf("refresh-0"), pendingOf(vault))
        val (dropped, _) = owner(logoutApi = ScriptedLogout(mutableListOf(LogoutAnswer.ALREADY_ENDED)))
        dropped.load()
        dropped.commitLogin(OWNER, "refresh-5", "access-5", 900_000L)
        dropped.signOut(online = true)
        assertEquals(listOf("refresh-0"), pendingOf(vault))
    }

    @Test
    fun `EVM-130 AC3 the sign-out waits for a running refresh and keeps the NEWEST token as the pending revocation`() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val api =
            RefreshApi {
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
                success(1)
            }
        val tokenOwner = TokenOwner(vault, api, clock, logout)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L)
        clock.now += 10_000L
        val pool = Executors.newFixedThreadPool(2)
        try {
            val refreshing = pool.submit<TokenResult> { tokenOwner.accessToken() }
            started.await(5, TimeUnit.SECONDS)
            val leaving = pool.submit { tokenOwner.signOut(online = false) }
            release.countDown()
            refreshing.get(5, TimeUnit.SECONDS)
            leaving.get(5, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
        assertEquals(listOf("refresh-1"), pendingOf(vault))
        assertNull(vault.record?.session)
    }

    @Test
    fun `EVM-130 AC3 a new sign-in of the same installation drops the pending revocations WITHOUT sending them`() {
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1", "old-2")))
        val (tokenOwner, api) = owner()
        tokenOwner.load()
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L, sameInstallation = true)
        assertEquals(TokenRecord(StoredSession(OWNER, "refresh-0"), emptyList()), vault.record)
        tokenOwner.flushPendingRevocations()
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 a sign-in that registered ANOTHER device keeps the pending revocation and sends it afterwards`() {
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (tokenOwner, api) = owner(success(5), logoutApi = ended)
        tokenOwner.load()
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L, sameInstallation = false)
        assertEquals(listOf("old-1"), pendingOf(vault))
        tokenOwner.flushPendingRevocations()
        assertEquals(listOf("old-1"), api.tokens)
        assertEquals(TokenRecord(StoredSession(OWNER, "refresh-0"), emptyList()), vault.record)
    }

    @Test
    fun `EVM-130 AC3 no revocation is sent while a session of step 2 waits for the device check`() {
        vault.content = VaultRead.Found(TokenRecord(null, listOf("old-1")))
        val (tokenOwner, api) = owner()
        tokenOwner.load()
        tokenOwner.stageLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.flushPendingRevocations()
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 several offline sign-outs keep the newest four pending revocations and send all of them`() {
        val (tokenOwner, api) = owner(success(11), success(12), success(13), success(14))
        for (n in 1..5) {
            tokenOwner.commitLogin(OWNER, "refresh-$n", "access-$n", 900_000L)
            tokenOwner.signOut(online = false)
        }
        assertEquals(listOf("refresh-2", "refresh-3", "refresh-4", "refresh-5"), pendingOf(vault))
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE, LogoutAnswer.DONE, LogoutAnswer.DONE, LogoutAnswer.DONE))
        val (flusher, flushApi) = owner(success(11), success(12), success(13), success(14), logoutApi = ended)
        flusher.load()
        flusher.flushPendingRevocations()
        assertEquals(listOf("refresh-2", "refresh-3", "refresh-4", "refresh-5"), flushApi.tokens)
        assertEquals(VaultRead.Empty, vault.content)
        assertTrue(api.tokens.isEmpty())
    }

    @Test
    fun `EVM-130 AC3 the same token is never kept twice, and signing out without a session asks nothing`() {
        val (tokenOwner, api) = owner()
        tokenOwner.signOut(online = true)
        assertTrue(api.tokens.isEmpty() && logout.tokens.isEmpty())
        assertEquals(VaultRead.Empty, vault.content)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        tokenOwner.signOut(online = false)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-1", 900_000L)
        tokenOwner.signOut(online = false)
        assertEquals(listOf("refresh-0"), pendingOf(vault))
    }

    @Test
    fun `EVM-130 AC3 a sign-out interrupted before the write ends the session anyway and keeps the token in memory for this process`() {
        val (tokenOwner, _) = signedIn()
        vault.failWrites = 1
        tokenOwner.signOut(online = false)
        assertEquals(VaultRead.Empty, vault.content)
        assertEquals(SessionState.SIGNED_OUT, tokenOwner.state())
        val ended = ScriptedLogout(mutableListOf(LogoutAnswer.DONE))
        val (again, flushApi) = owner(success(3), logoutApi = ended)
        again.commitLogin(OWNER, "refresh-2", "access-2", 900_000L)
        vault.failWrites = 1
        vault.failClears = 1
        again.signOut(online = false)
        assertEquals(SessionState.SIGNED_OUT, again.state())
        again.flushPendingRevocations()
        assertEquals(listOf("refresh-2"), flushApi.tokens)
    }
}
