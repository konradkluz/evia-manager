package pl.eviacharge.upload.session

import pl.eviacharge.upload.files.JobFileCodec
import pl.eviacharge.upload.files.OwnerId

/**
 * The check of what the app hands over at a sign-in (step 2, [TokenOwner.stageLogin] / [TokenOwner.commitLogin]) before it is stored:
 * the identifiers have the shape of the server's (they become the owner `userId:deviceId` of the jobs), the tokens are not empty and not
 * longer than the store can read back (a token that is stored but unreadable after a restart would silently end the session), and the
 * lifetime of the access token is positive and sane. The result carries no token and the failure no value.
 */
object LoginInput {
    const val MAX_TOKEN_CHARS = 4096
    const val MAX_ACCESS_VALID_MS = 24L * 60 * 60 * 1000

    /** The owner (`userId:deviceId`) of valid input, else `null`. */
    fun ownerOf(
        userId: String,
        deviceId: String,
        refreshToken: String,
        accessToken: String,
        accessValidForMs: Long,
    ): String? {
        val valid =
            JobFileCodec.isIdentifier(userId) &&
                JobFileCodec.isIdentifier(deviceId) &&
                tokenOk(refreshToken) &&
                tokenOk(accessToken) &&
                accessValidForMs in 1..MAX_ACCESS_VALID_MS
        return if (valid) OwnerId.of(userId, deviceId) else null
    }

    private fun tokenOk(token: String): Boolean = token.isNotEmpty() && token.length <= MAX_TOKEN_CHARS && token.none { it.isISOControl() }
}
