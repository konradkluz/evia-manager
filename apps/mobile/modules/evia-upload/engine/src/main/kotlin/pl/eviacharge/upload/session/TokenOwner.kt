package pl.eviacharge.upload.session

import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.files.ContactSink
import java.io.IOException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What is persisted about a session: who it belongs to (ids only) and the refresh token. */
data class StoredSession(
    val ownerId: String,
    val refreshToken: String,
)

/**
 * The whole persisted record of the token owner: the session (none after a sign-out) and the refresh tokens of ended sessions whose
 * revocation on the server is still pending (at most [TokenOwner.MAX_PENDING_REVOCATIONS], the newest). One file, one atomic write:
 * ending a session and keeping its token for the revocation is a single step, so a killed process never has both or neither.
 */
data class TokenRecord(
    val session: StoredSession?,
    val pendingRevocations: List<String>,
)

sealed interface VaultRead {
    /** No file: the app was never signed in (or the wipe removed everything). */
    data object Empty : VaultRead

    data class Found(
        val record: TokenRecord,
    ) : VaultRead

    /** A corrupt record, a failed decryption or a missing key: "sign in again", never a crash and never a plain-text fallback. */
    data object Unreadable : VaultRead
}

/** The durable store of the tokens (EVM-130: an AES-GCM file, the key in the Keystore); a write is durable when it returns. */
interface TokenVault {
    fun read(): VaultRead

    /** @throws IOException when the record was not stored durably (the old record is then intact). */
    fun write(record: TokenRecord)

    /** @throws IOException when the record could not be removed. */
    fun clear()
}

/** Monotonic time, injected so that the 20 s window never depends on the wall clock (SR-SESS-09). */
fun interface MonotonicClock {
    fun nowMs(): Long
}

/**
 * The `POST /auth/mobile/token` call. The adapter tells a failure before the request left the device from one after it, and keeps to the
 * policy of the HTTP client (https only, no redirects, timeouts). An interrupted call throws [UploadCancelledException].
 */
fun interface RefreshApi {
    fun refresh(refreshToken: String): RefreshAnswer
}

sealed interface RefreshAnswer {
    /** [accessValidForMs] counts from the moment of the answer; [serverTimeMs] is the time of the server when it was given. */
    data class Success(
        val accessToken: String,
        val accessValidForMs: Long,
        val refreshToken: String,
        val serverTimeMs: Long? = null,
    ) : RefreshAnswer

    /** `401 session_revoked` (and any other `401` but the wipe): the token is no longer valid. */
    data object Revoked : RefreshAnswer

    /** `401 device_wipe_required`. */
    data object WipeRequired : RefreshAnswer

    /** `403`: the server answered and did not use the token. */
    data object Forbidden : RefreshAnswer

    /** `426`. */
    data object UpdateRequired : RefreshAnswer

    /** The connection failed before the request was sent: the token is untouched. */
    data object NotSent : RefreshAnswer

    /** The request was sent but no usable answer came (timeout, reset, 5xx, 429): the token may have been used by the server. */
    data object NoAnswer : RefreshAnswer
}

/** The `POST /auth/mobile/logout` call with an access token. */
fun interface LogoutApi {
    fun logout(accessToken: String): LogoutAnswer
}

enum class LogoutAnswer {
    /** `2xx`: the session ended. */
    DONE,

    /** `401` or `403`: the session is already over, nothing is left to revoke. */
    ALREADY_ENDED,

    /** No answer, `5xx`, `429` or `426`: ask again later. */
    UNAVAILABLE,
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

/** What the HTTP adapter of the API needs from the owner: an access token and the way to report what the server said. */
interface ApiSession {
    fun accessToken(): TokenResult

    fun accessTokenRejected(rejected: String): TokenResult

    /** The API answered `401 session_revoked`: tokens go, the work pauses. */
    fun onApiRevoked()

    /** The API answered `401 device_wipe_required`. */
    fun onApiWipeRequired()

    /** The API answered `426`: the work waits for an update of the app; tokens and files stay. */
    fun onApiUpdateRequired()
}

/**
 * The single owner of the tokens in the process (EVM-130 AC2, AC3; ADR-0020a). The foreground app and the job service share ONE instance
 * and one lock, so a refresh happens once and the server never sees a reused token from our side. Rules: the new refresh token is
 * stored durably before the new access token is used; a failure before the request leaves the token untouched; a sent request without an
 * answer is retried with the same token within [WINDOW_MS] (monotonic), after that the session needs a new sign-in (no false reuse alert);
 * `session_revoked` pauses the work and keeps files and queue; resuming needs a full sign-in of the same owner ([commitLogin]).
 *
 * There is no method that returns a refresh token or a revocation token: the tokens go in ([stageLogin], [commitLogin]) and are used here.
 */
class TokenOwner(
    private val vault: TokenVault,
    private val api: RefreshApi,
    private val clock: MonotonicClock,
    private val logoutApi: LogoutApi,
    private val contact: ContactSink = ContactSink.NONE,
) : ApiSession {
    private class Staged(
        val ownerId: String,
        val refreshToken: String,
        val accessToken: String,
        val accessValidForMs: Long,
        val serverTimeMs: Long?,
    )

    private val lock = ReentrantLock()
    private var state = SessionState.SIGNED_OUT
    private var ownerId: String? = null
    private var refreshToken: String? = null
    private var access: String? = null
    private var accessUntil = 0L
    private var pending = mutableListOf<String>()

    /** Step 2 of a sign-in that waits for the device check: nothing of it is stored yet. */
    private var staged: Staged? = null

    /** A rotated token the vault refused to store: kept in memory and stored first on the next call; its access token is withheld. */
    private var unstored: RefreshAnswer.Success? = null

    /** The token of a request that was sent without an answer, and when (monotonic). */
    private var sentToken: String? = null
    private var sentAt = 0L

    /** Loads the persisted record at the start of the process. A corrupt or unreadable record means a new sign-in. */
    fun load(): SessionState =
        lock.withLock {
            when (val read = vault.read()) {
                VaultRead.Empty -> {
                    state = SessionState.SIGNED_OUT
                }

                VaultRead.Unreadable -> {
                    pending = mutableListOf()
                    state = SessionState.NEEDS_LOGIN
                }

                is VaultRead.Found -> {
                    pending = read.record.pendingRevocations.toMutableList()
                    val session = read.record.session
                    ownerId = session?.ownerId
                    refreshToken = session?.refreshToken
                    state = if (session == null) SessionState.SIGNED_OUT else SessionState.SIGNED_IN
                }
            }
            state
        }

    fun state(): SessionState = lock.withLock { state }

    /** The owner (`userId:deviceId`) of the session, `null` unless signed in. Not a secret. */
    fun currentOwnerId(): String? = lock.withLock { if (state == SessionState.SIGNED_IN) ownerId else null }

    /** True when work of [jobOwnerId] may go on: signed in as that owner (SR-MOB-13: a job of another owner is refused). */
    fun mayWork(jobOwnerId: String): Boolean = lock.withLock { state == SessionState.SIGNED_IN && ownerId == jobOwnerId }

    /**
     * Step 2 of the sign-in while the device check runs: the app hands the tokens over once and keeps nothing; they live in memory only
     * until [commitStaged] or [abandonStaged]. An earlier staged session is ended first.
     */
    fun stageLogin(
        newOwnerId: String,
        newRefreshToken: String,
        accessToken: String,
        accessValidForMs: Long,
        serverTimeMs: Long? = null,
    ) = lock.withLock {
        staged?.let { discardLocked(it) }
        staged = Staged(newOwnerId, newRefreshToken, accessToken, accessValidForMs, serverTimeMs)
    }

    /**
     * The device check went on: the staged session is stored. [sameInstallation] (the same device id as before) drops the pending
     * revocations WITHOUT sending them: the server already ended those sessions, and a refresh of them now could look like reuse and
     * end the new session (security W1d). When the record cannot be stored the staged session is ended on the server (or kept as a
     * pending revocation) and the failure is thrown.
     * @throws IOException when the session cannot be stored (the sign-in then fails visibly).
     * @throws IllegalStateException when nothing is staged.
     */
    fun commitStaged(sameInstallation: Boolean = false) =
        lock.withLock {
            val ready = checkNotNull(staged) { "no staged sign-in" }
            commitLocked(ready, sameInstallation)
        }

    /** Step 2 of the sign-in without a device check in between: the session is stored at once ([stageLogin] and [commitStaged]). */
    fun commitLogin(
        newOwnerId: String,
        newRefreshToken: String,
        accessToken: String,
        accessValidForMs: Long,
        sameInstallation: Boolean = false,
        serverTimeMs: Long? = null,
    ) = lock.withLock {
        staged?.let { discardLocked(it) }
        commitLocked(Staged(newOwnerId, newRefreshToken, accessToken, accessValidForMs, serverTimeMs), sameInstallation)
    }

    /** The device check was cancelled: the staged session is ended on the server; when that is not possible its token becomes a pending revocation. */
    fun abandonStaged() =
        lock.withLock {
            val ready = staged ?: return@withLock
            staged = null
            discardLocked(ready)
        }

    private fun commitLocked(
        ready: Staged,
        sameInstallation: Boolean,
    ) {
        val kept = if (sameInstallation) emptyList() else pending.toList()
        try {
            vault.write(TokenRecord(StoredSession(ready.ownerId, ready.refreshToken), kept))
        } catch (error: IOException) {
            staged = null
            discardLocked(ready)
            throw error
        }
        staged = null
        pending = kept.toMutableList()
        ownerId = ready.ownerId
        refreshToken = ready.refreshToken
        access = ready.accessToken
        accessUntil = clock.nowMs() + ready.accessValidForMs
        unstored = null
        sentToken = null
        state = SessionState.SIGNED_IN
        contact.contact(ready.serverTimeMs)
    }

    /** A session that is not kept: a best-effort logout with its access token; without an answer its refresh token is a pending revocation. */
    private fun discardLocked(dropped: Staged) {
        val answer =
            try {
                logoutApi.logout(dropped.accessToken)
            } catch (error: UploadCancelledException) {
                addPendingLocked(dropped.refreshToken)
                throw error
            }
        if (answer == LogoutAnswer.UNAVAILABLE) addPendingLocked(dropped.refreshToken)
    }

    /** An access token for a request; refreshes once when the held one is missing or about to expire. */
    override fun accessToken(): TokenResult =
        lock.withLock {
            state.blockedOrNull()?.let { return@withLock it }
            val held = access
            if (held != null && clock.nowMs() < accessUntil - SKEW_MS) {
                return@withLock TokenResult.Ready(held, ownerId.orEmpty())
            }
            refreshLocked()
        }

    /** The server refused [rejected] (expired earlier than we thought): drop it and refresh, unless someone already did. */
    override fun accessTokenRejected(rejected: String): TokenResult =
        lock.withLock {
            state.blockedOrNull()?.let { return@withLock it }
            if (access != null && access != rejected && clock.nowMs() < accessUntil - SKEW_MS) {
                return@withLock TokenResult.Ready(access.orEmpty(), ownerId.orEmpty())
            }
            access = null
            refreshLocked()
        }

    override fun onApiRevoked() = lock.withLock { pause(SessionState.PAUSED_REVOKED) }

    override fun onApiWipeRequired() = lock.withLock { pause(SessionState.WIPE_REQUIRED) }

    override fun onApiUpdateRequired() =
        lock.withLock {
            access = null
            state = SessionState.PAUSED_UPDATE
        }

    /**
     * "Log out": the session ends at once, in memory and in the store, in ONE write that also keeps its refresh token as a pending
     * revocation. Online, the server is asked: with a valid access token by a logout, otherwise through the revocation path (a refresh,
     * the rotated token stored before the logout, SR-SESS-09). Without a session it does nothing.
     */
    fun signOut(online: Boolean) =
        lock.withLock {
            val token = refreshToken
            val validAccess = access?.takeIf { clock.nowMs() < accessUntil - SKEW_MS }
            if (token != null) addPendingLocked(token, persist = false)
            endSessionLocked(SessionState.SIGNED_OUT)
            if (!online || token == null) return@withLock
            if (validAccess == null) {
                flushLocked()
            } else if (logoutApi.logout(validAccess) != LogoutAnswer.UNAVAILABLE) {
                removePendingLocked(token)
            }
        }

    /** Sends the pending revocations (after a sign-in, at start and whenever the network returns); never while a sign-in waits for the device check. */
    fun flushPendingRevocations() =
        lock.withLock {
            if (staged == null) flushLocked()
        }

    /** The wipe step: tokens and store are removed, the state stays [SessionState.WIPE_REQUIRED] until a full sign-in after the wipe. */
    fun wipe() =
        lock.withLock {
            clearMemory()
            pending = mutableListOf()
            staged = null
            state = SessionState.WIPE_REQUIRED
            try {
                vault.clear()
            } catch (error: IOException) {
                // memory is clean; the chain of the wipe removes the file again and keeps trying until it is gone
            }
        }

    private fun SessionState.blockedOrNull(): TokenResult? =
        when (this) {
            SessionState.SIGNED_IN -> null
            else -> TokenResult.Blocked(this)
        }

    private fun clearMemory() {
        access = null
        refreshToken = null
        ownerId = null
        unstored = null
        sentToken = null
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

            RefreshAnswer.NotSent, RefreshAnswer.Forbidden -> {
                // nothing was used: the token is untouched, the window starts again with the next real send
                sentToken = null
                TokenResult.RetryLater
            }

            RefreshAnswer.NoAnswer -> {
                TokenResult.RetryLater
            }

            RefreshAnswer.Revoked -> {
                pause(SessionState.PAUSED_REVOKED)
                TokenResult.Blocked(state)
            }

            RefreshAnswer.WipeRequired -> {
                pause(SessionState.WIPE_REQUIRED)
                TokenResult.Blocked(state)
            }

            RefreshAnswer.UpdateRequired -> {
                // the work waits for an update of the app; tokens and files stay, the next process start loads the session again
                access = null
                state = SessionState.PAUSED_UPDATE
                TokenResult.Blocked(state)
            }
        }
    }

    private fun persistAndUse(success: RefreshAnswer.Success): TokenResult {
        val owner = ownerId.orEmpty()
        refreshToken = success.refreshToken
        try {
            vault.write(currentRecord())
        } catch (error: IOException) {
            // not stored: the rotated token lives in memory, the new access token is not used before it is stored
            unstored = success
            sentToken = null
            return TokenResult.RetryLater
        }
        unstored = null
        sentToken = null
        access = success.accessToken
        accessUntil = clock.nowMs() + success.accessValidForMs
        contact.contact(success.serverTimeMs)
        return TokenResult.Ready(success.accessToken, owner)
    }

    private fun markNeedsLogin(): TokenResult {
        access = null
        state = SessionState.NEEDS_LOGIN
        return TokenResult.Blocked(state)
    }

    /** The store and the memory lose the refresh token and the access token together; the pending revocations stay; files and queue are not touched. */
    private fun pause(next: SessionState) {
        endSessionLocked(next)
    }

    private fun endSessionLocked(next: SessionState) {
        clearMemory()
        state = next
        try {
            storeRecord()
        } catch (error: IOException) {
            // the session must be gone from the store: when the new record cannot be written, the old one is removed instead
            try {
                vault.clear()
            } catch (again: IOException) {
                // memory is clean and no token is used again; the next start finds the record and the sign-in is the way out
            }
        }
    }

    /** An empty record (no session, nothing pending) is not kept: the file goes. */
    private fun storeRecord() {
        val record = currentRecord()
        if (record.session == null && record.pendingRevocations.isEmpty()) vault.clear() else vault.write(record)
    }

    private fun currentRecord(): TokenRecord {
        val owner = ownerId
        val token = refreshToken
        return TokenRecord(if (owner != null && token != null) StoredSession(owner, token) else null, pending.toList())
    }

    private fun addPendingLocked(
        token: String,
        persist: Boolean = true,
    ) {
        pending = (pending.filter { it != token } + token).takeLast(MAX_PENDING_REVOCATIONS).toMutableList()
        if (persist) persistPending()
    }

    private fun removePendingLocked(token: String) {
        pending = pending.filter { it != token }.toMutableList()
        persistPending()
    }

    private fun replacePendingLocked(
        used: String,
        next: String,
    ) {
        pending = pending.map { if (it == used) next else it }.distinct().toMutableList()
        persistPending()
    }

    /** The pending list in memory is the truth of this process; a failed write is tried again with the next change. */
    private fun persistPending() {
        try {
            storeRecord()
        } catch (error: IOException) {
            // kept in memory
        }
    }

    private fun flushLocked() {
        for (token in pending.toList()) {
            when (val answer = api.refresh(token)) {
                is RefreshAnswer.Success -> {
                    contact.contact(answer.serverTimeMs)
                    // the rotated token replaces the used one BEFORE the logout: a retry later never reuses a spent token (SR-SESS-09)
                    replacePendingLocked(token, answer.refreshToken)
                    if (logoutApi.logout(answer.accessToken) == LogoutAnswer.UNAVAILABLE) return
                    removePendingLocked(answer.refreshToken)
                }

                RefreshAnswer.Revoked, RefreshAnswer.WipeRequired, RefreshAnswer.Forbidden -> {
                    removePendingLocked(token)
                }

                RefreshAnswer.NotSent, RefreshAnswer.NoAnswer, RefreshAnswer.UpdateRequired -> {
                    return
                }
            }
        }
    }

    companion object {
        /** The tolerance of the server is 30 s; the client keeps to 20 s so that it never reaches the edge (SR-SESS-09). */
        const val WINDOW_MS = 20_000L

        /** An access token this close to its end is refreshed before use. */
        const val SKEW_MS = 30_000L

        /** At most this many pending revocations are kept (a fifth drops the oldest; the server ends a session after 14 idle days anyway). */
        const val MAX_PENDING_REVOCATIONS = 4
    }
}
