package pl.eviacharge.upload.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val OWNER = "user-1:device-1"

private class MemoryVault(
    var stored: StoredSession? = null,
    var failWrites: Int = 0,
    private val events: MutableList<String> = mutableListOf(),
) : TokenVault {
    val log: List<String> get() = events

    override fun read(): StoredSession? = stored

    override fun write(session: StoredSession) {
        if (failWrites > 0) {
            failWrites -= 1
            throw IOException("disk full")
        }
        events.add("write:${session.refreshToken}")
        stored = session
    }

    override fun clear() {
        events.add("clear")
        stored = null
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

private fun success(n: Int) = RefreshAnswer.Success("access-$n", 900_000L, "refresh-$n")

class TokenOwnerTest {
    private val vault = MemoryVault()
    private val clock = FakeClock()

    private fun owner(vararg answers: RefreshAnswer): Pair<TokenOwner, ScriptedApi> {
        val api = ScriptedApi(answers.toMutableList())
        return TokenOwner(vault, api, clock) to api
    }

    private fun signedIn(vararg answers: RefreshAnswer): Pair<TokenOwner, ScriptedApi> {
        val (tokenOwner, api) = owner(*answers)
        tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 900_000L)
        return tokenOwner to api
    }

    @Test
    fun `EVM-130 AC3 the sign-in is stored once, the app keeps nothing, and the valid access token is served without a refresh`() {
        val (tokenOwner, api) = signedIn()
        assertEquals(listOf("write:refresh-0"), vault.log)
        assertEquals(TokenResult.Ready("access-0", OWNER), tokenOwner.accessToken())
        assertTrue(api.tokens.isEmpty())
        assertTrue(tokenOwner.mayWork(OWNER))
        assertFalse(tokenOwner.mayWork("someone-else"))
    }

    @Test
    fun `EVM-130 AC3 a sign-in that cannot be stored fails visibly and changes nothing`() {
        val (tokenOwner, _) = owner()
        vault.failWrites = 1
        assertThrows(IOException::class.java) { tokenOwner.commitLogin(OWNER, "refresh-0", "access-0", 1000L) }
        assertEquals(SessionState.SIGNED_OUT, tokenOwner.state())
        assertNull(vault.stored)
    }

    @Test
    fun `EVM-130 AC3 load restores the session from the store and treats a missing or unreadable record as a new sign-in`() {
        val (empty, _) = owner()
        assertEquals(SessionState.NEEDS_LOGIN, empty.load())
        assertEquals(TokenResult.Blocked(SessionState.NEEDS_LOGIN), empty.accessToken())
        vault.stored = StoredSession(OWNER, "refresh-7")
        val (restored, api) = owner(success(8))
        assertEquals(SessionState.SIGNED_IN, restored.load())
        assertEquals(TokenResult.Ready("access-8", OWNER), restored.accessToken())
        assertEquals(listOf("refresh-7"), api.tokens)
    }

    @Test
    fun `EVM-130 AC2 the new refresh token is stored before the new access token is used`() {
        val (tokenOwner, _) = signedIn(success(1))
        clock.now += 900_000L
        val result = tokenOwner.accessToken()
        assertEquals(TokenResult.Ready("access-1", OWNER), result)
        assertEquals(listOf("write:refresh-0", "write:refresh-1"), vault.log)
        assertEquals("refresh-1", vault.stored?.refreshToken)
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
        assertEquals("refresh-0", vault.stored?.refreshToken)
        assertEquals(TokenResult.Ready("access-1", OWNER), tokenOwner.accessToken())
        assertEquals("refresh-1", vault.stored?.refreshToken)
        assertEquals(1, api.tokens.size)
        // a failure that lasts keeps withholding the access token and does not refresh again
        clock.now += 900_000L
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
        assertEquals(listOf("write:refresh-0", "write:refresh-1"), vault.log)
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
        val tokenOwner = TokenOwner(vault, api, clock)
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
    }

    @Test
    fun `EVM-130 AC2 session_revoked pauses the work, drops both tokens at once and a full sign-in of the same owner resumes it`() {
        val (tokenOwner, _) = signedIn(RefreshAnswer.Revoked)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_REVOKED), tokenOwner.accessToken())
        assertNull(vault.stored)
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
    fun `EVM-130 AC5 device_wipe_required and 426 stop the work, the wipe and the sign-out remove the tokens`() {
        val (wiped, _) = signedIn(RefreshAnswer.WipeRequired)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.WIPE_REQUIRED), wiped.accessToken())
        assertNull(vault.stored)

        val (outdated, _) = signedIn(RefreshAnswer.UpdateRequired)
        clock.now += 900_000L
        assertEquals(TokenResult.Blocked(SessionState.PAUSED_UPDATE), outdated.accessToken())
        assertEquals("refresh-0", vault.stored?.refreshToken)
        assertFalse(outdated.mayWork(OWNER))

        val (leaving, _) = signedIn()
        leaving.signOut()
        assertEquals(SessionState.SIGNED_OUT, leaving.state())
        assertNull(vault.stored)
        assertEquals(TokenResult.Blocked(SessionState.SIGNED_OUT), leaving.accessToken())

        val (forced, _) = signedIn()
        forced.wipe()
        assertEquals(TokenResult.Blocked(SessionState.WIPE_REQUIRED), forced.accessToken())
        assertNull(vault.stored)
    }

    @Test
    fun `EVM-130 AC3 the refresh token never leaves the owner through the results`() {
        val (tokenOwner, _) = signedIn(success(1))
        clock.now += 900_000L
        val result = tokenOwner.accessToken()
        assertFalse(result.toString().contains("refresh-"))
        assertFalse(tokenOwner.state().toString().contains("refresh-"))
    }
}
