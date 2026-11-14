package pl.eviacharge.upload.session

import java.io.IOException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The refresh token in the native store (ADR-0020a, SR-SESS-09): the only place that holds it. A write is durable when it returns
 * (atomic file replace, fsync); [read] returns null when there is no session or the record cannot be read (a corrupt record is "sign in
 * again", never a crash and never a plain-text fallback).
 */
interface TokenVault {
    fun read(): StoredSession?

    /** @throws IOException when the record was not stored durably. */
    fun write(session: StoredSession)

    fun clear()
}

/** What is persisted: who the session belongs to (ids only) and the refresh token. */
data class StoredSession(
    val ownerId: String,
    val refreshToken: String,
)

/** Monotonic time, injected so that the 20 s window never depends on the wall clock (SR-SESS-09). */
fun interface MonotonicClock {
    fun nowMs(): Long
}

/** The `POST /auth/mobile/token` call; the adapter tells a failure before the request left the device from one after it. */
fun interface RefreshApi {
    fun refresh(refreshToken: String): RefreshAnswer
}

sealed interface RefreshAnswer {
    /** [accessValidForMs] counts from the moment of the answer. */
    data class Success(
        val accessToken: String,
        val accessValidForMs: Long,
        val refreshToken: String,
    ) : RefreshAnswer

    /** `401 session_revoked`. */
    data object Revoked : RefreshAnswer

    /** `401 device_wipe_required`. */
    data object WipeRequired : RefreshAnswer

    /** `426`. */
    data object UpdateRequired : RefreshAnswer

    /** The connection failed before the request was sent: the token is untouched. */
    data object NotSent : RefreshAnswer

    /** The request was sent but no usable answer came (timeout, reset, 5xx, 429): the token may have been used by the server. */
    data object NoAnswer : RefreshAnswer
}

enum class SessionState { SIGNED_OUT, SIGNED_IN, NEEDS_LOGIN, PAUSED_REVOKED, PAUSED_UPDATE, WIPE_REQUIRED }

/** The answer to "give me an access token". */
sealed interface TokenResult {
    data class Ready(
        val accessToken: String,
        val ownerId: String,
    ) : TokenResult

    /** Try again later with backoff: nothing is lost, the token is as it was. */
    data object RetryLater : TokenResult

    data class Blocked(
        val state: SessionState,
    ) : TokenResult
}

/**
 * The single owner of the tokens in the process (EVM-130 AC2, AC3; ADR-0020a). The foreground app and the job service share ONE instance
 * and one lock, so a refresh happens once and the server never sees a reused token from our side. Rules: the new refresh token is
 * stored durably before the new access token is used; a failure before the request leaves the token untouched; a sent request without an
 * answer is retried with the same token within [WINDOW_MS] (monotonic), after that the session needs a new sign-in (no false reuse alert);
 * `session_revoked` pauses the work and keeps files and queue; resuming needs a full sign-in of the same owner ([commitLogin]).
 */
class TokenOwner(
    private val vault: TokenVault,
    private val api: RefreshApi,
    private val clock: MonotonicClock,
) {
    private val lock = ReentrantLock()
    private var state = SessionState.SIGNED_OUT
    private var ownerId: String? = null
    private var refreshToken: String? = null
    private var access: String? = null
    private var accessUntil = 0L

    /** A rotated token the vault refused to store: kept in memory and stored first on the next call; its access token is withheld. */
    private var unstored: RefreshAnswer.Success? = null

    /** The token of a request that was sent without an answer, and when (monotonic). */
    private var sentToken: String? = null
    private var sentAt = 0L

    /** Loads the persisted session at the start of the process. A missing or unreadable record means a new sign-in. */
    fun load(): SessionState =
        lock.withLock {
            val stored = vault.read()
            if (stored == null) {
                state = SessionState.NEEDS_LOGIN
            } else {
                ownerId = stored.ownerId
                refreshToken = stored.refreshToken
                state = SessionState.SIGNED_IN
            }
            state
        }

    fun state(): SessionState = lock.withLock { state }

    /** True when work of [jobOwnerId] may go on: signed in as that owner (SR-MOB-13: a job of another owner is refused). */
    fun mayWork(jobOwnerId: String): Boolean = lock.withLock { state == SessionState.SIGNED_IN && ownerId == jobOwnerId }

    /**
     * Step 2 of the sign-in: the app hands the refresh token over once, for storing only; it keeps nothing. A paused or wiped state ends
     * here; [mayWork] lets only the owner of a job work again.
     * @throws IOException when the token cannot be stored (the sign-in then fails visibly).
     */
    fun commitLogin(
        newOwnerId: String,
        newRefreshToken: String,
        accessToken: String,
        accessValidForMs: Long,
    ) = lock.withLock {
        vault.write(StoredSession(newOwnerId, newRefreshToken))
        ownerId = newOwnerId
        refreshToken = newRefreshToken
        access = accessToken
        accessUntil = clock.nowMs() + accessValidForMs
        unstored = null
        sentToken = null
        state = SessionState.SIGNED_IN
    }

    /** An access token for a request; refreshes once when the held one is missing or about to expire. */
    fun accessToken(): TokenResult =
        lock.withLock {
            state.blockedOrNull()?.let { return@withLock it }
            val held = access
            if (held != null && clock.nowMs() < accessUntil - SKEW_MS) {
                return@withLock TokenResult.Ready(held, ownerId.orEmpty())
            }
            refreshLocked()
        }

    /** The server refused [rejected] (expired earlier than we thought): drop it and refresh, unless someone already did. */
    fun accessTokenRejected(rejected: String): TokenResult =
        lock.withLock {
            state.blockedOrNull()?.let { return@withLock it }
            if (access != null && access != rejected && clock.nowMs() < accessUntil - SKEW_MS) {
                return@withLock TokenResult.Ready(access.orEmpty(), ownerId.orEmpty())
            }
            access = null
            refreshLocked()
        }

    /** "Log out" and `session_revoked` seen by the foreground: both tokens are gone from memory and the store at once. */
    fun signOut() =
        lock.withLock {
            vault.clear()
            access = null
            refreshToken = null
            unstored = null
            sentToken = null
            state = SessionState.SIGNED_OUT
        }

    /** The wipe step: tokens and store are removed, the state stays [SessionState.WIPE_REQUIRED] until a full sign-in after the wipe. */
    fun wipe() =
        lock.withLock {
            vault.clear()
            access = null
            refreshToken = null
            unstored = null
            sentToken = null
            state = SessionState.WIPE_REQUIRED
        }

    private fun SessionState.blockedOrNull(): TokenResult? =
        when (this) {
            SessionState.SIGNED_IN -> null
            else -> TokenResult.Blocked(this)
        }

    private fun refreshLocked(): TokenResult {
        unstored?.let { return persistAndUse(it) }
        val token = refreshToken ?: return markNeedsLogin()
        val now = clock.nowMs()
        if (sentToken == token && now - sentAt > WINDOW_MS) return markNeedsLogin()
        if (sentToken != token) {
            sentToken = token
            sentAt = now
        }
        return when (val answer = api.refresh(token)) {
            is RefreshAnswer.Success -> {
                persistAndUse(answer)
            }

            RefreshAnswer.NotSent -> {
                // nothing left the device: the token is untouched, the window starts again with the next real send
                sentToken = null
                TokenResult.RetryLater
            }

            RefreshAnswer.NoAnswer -> {
                TokenResult.RetryLater
            }

            RefreshAnswer.Revoked -> {
                pause(SessionState.PAUSED_REVOKED)
            }

            RefreshAnswer.WipeRequired -> {
                pause(SessionState.WIPE_REQUIRED)
            }

            RefreshAnswer.UpdateRequired -> {
                // the work waits for an update of the app; tokens and files stay, the next process start loads the session again
                state = SessionState.PAUSED_UPDATE
                TokenResult.Blocked(state)
            }
        }
    }

    private fun persistAndUse(success: RefreshAnswer.Success): TokenResult {
        val owner = ownerId.orEmpty()
        try {
            vault.write(StoredSession(owner, success.refreshToken))
        } catch (_: IOException) {
            // not stored: the rotated token lives in memory, the new access token is not used before it is stored
            unstored = success
            refreshToken = success.refreshToken
            sentToken = null
            return TokenResult.RetryLater
        }
        unstored = null
        refreshToken = success.refreshToken
        sentToken = null
        access = success.accessToken
        accessUntil = clock.nowMs() + success.accessValidForMs
        return TokenResult.Ready(success.accessToken, owner)
    }

    private fun markNeedsLogin(): TokenResult {
        access = null
        state = SessionState.NEEDS_LOGIN
        return TokenResult.Blocked(state)
    }

    private fun pause(next: SessionState): TokenResult {
        // the store and the memory lose the refresh token and the access token together; files and queue are not touched here
        vault.clear()
        access = null
        refreshToken = null
        unstored = null
        sentToken = null
        state = next
        return TokenResult.Blocked(next)
    }

    companion object {
        /** The tolerance of the server is 30 s; the client keeps to 20 s so that it never reaches the edge (SR-SESS-09). */
        const val WINDOW_MS = 20_000L

        /** An access token this close to its end is refreshed before use. */
        const val SKEW_MS = 30_000L
    }
}
