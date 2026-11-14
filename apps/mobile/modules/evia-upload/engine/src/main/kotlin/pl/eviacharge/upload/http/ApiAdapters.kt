package pl.eviacharge.upload.http

import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.FileState
import pl.eviacharge.upload.Json
import pl.eviacharge.upload.JsonException
import pl.eviacharge.upload.PartUrl
import pl.eviacharge.upload.RemotePart
import pl.eviacharge.upload.SessionInfo
import pl.eviacharge.upload.UploadApi
import pl.eviacharge.upload.UploadFailure
import pl.eviacharge.upload.files.ContactSink
import pl.eviacharge.upload.session.ApiSession
import pl.eviacharge.upload.session.LogoutAnswer
import pl.eviacharge.upload.session.LogoutApi
import pl.eviacharge.upload.session.RefreshAnswer
import pl.eviacharge.upload.session.RefreshApi
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenResult
import java.net.URL

private val IDENTIFIER = Regex("^[A-Za-z0-9-]{1,64}$")
private val PROBLEM_CODE = Regex("^[a-z0-9_]{1,64}$")
private const val MAX_TOKEN_CHARS = 4096
private const val MAX_PARTS = 1000

/** The JSON of an answer as a map, or `null` when it is not an object, too long or invalid. */
internal fun HttpResponse.jsonObject(): Map<*, *>? {
    val bytes = body ?: return null
    return try {
        Json.parse(String(bytes, Charsets.UTF_8)) as? Map<*, *>
    } catch (error: JsonException) {
        null
    }
}

/** The `code` of the problem at the top level (the detail is `errors[].code`, which only describes it; the top level decides). */
internal fun HttpResponse.problemCode(): String? = (jsonObject()?.get("code") as? String)?.takeIf { PROBLEM_CODE.matches(it) }

private fun clientHeaders(config: HttpConfig) =
    mapOf(
        "Accept" to "application/json",
        "X-Client-Platform" to "android",
        "X-Client-Version" to config.clientVersion,
    )

private fun jsonBody(fields: Map<String, Any?>): ByteArray = Json.stringify(fields).toByteArray(Charsets.UTF_8)

/**
 * The API of the upload of one file (`createUploadSession`, `listUploadParts`, `getUploadPartUrl`, `completeUploadSession`) for the engine.
 * It takes the access token from the owner, repeats a call once after a plain `401` (a refresh through the owner) and maps every
 * answer to a failure of the engine: the `code` of the problem at the top level decides (422 `upload_incomplete` is not the same as
 * `idempotency_mismatch`), `429` carries `Retry-After`, a cancelled call is never a network failure. Every identifier that goes into a
 * path is checked before. An authenticated success is a contact with the server ([ContactSink], the 7-day rule).
 */
class HttpUploadApi(
    private val core: HttpCore,
    private val session: ApiSession,
    private val contact: ContactSink,
    workOrderId: String,
    mediaAssetId: String,
) : UploadApi {
    private val base: String

    init {
        require(IDENTIFIER.matches(workOrderId) && IDENTIFIER.matches(mediaAssetId)) { "invalid identifier" }
        base = "/api/v1/work-orders/$workOrderId/media-assets/$mediaAssetId/upload-sessions"
    }

    override fun createSession(
        assetId: String,
        sessionId: String,
        idempotencyKey: String,
    ): SessionInfo {
        val answer =
            send(
                "POST",
                base,
                mapOf("Idempotency-Key" to checked(idempotencyKey), "Content-Type" to "application/json"),
                jsonBody(mapOf("id" to checked(sessionId))),
            )
        val fields = answer.jsonObject() ?: throw invalid(answer)
        val id = fields["id"] as? String ?: throw invalid(answer)
        val partSize = (fields["partSize"] as? Long) ?: throw invalid(answer)
        val partCount = (fields["partCount"] as? Long)?.takeIf { it in 1..MAX_PARTS } ?: throw invalid(answer)
        return SessionInfo(id, partSize, partCount.toInt())
    }

    override fun listParts(sessionId: String): List<RemotePart> {
        val answer = send("GET", "$base/${checked(sessionId)}/parts", emptyMap(), null)
        val items = answer.jsonObject()?.get("items") as? List<*> ?: throw invalid(answer)
        if (items.size > MAX_PARTS) throw invalid(answer)
        return items.map { item ->
            val part = item as? Map<*, *> ?: throw invalid(answer)
            RemotePart(((part["partNumber"] as? Long) ?: throw invalid(answer)).toInt(), (part["size"] as? Long) ?: throw invalid(answer))
        }
    }

    override fun partUrl(
        sessionId: String,
        partNumber: Int,
    ): PartUrl {
        require(partNumber in 1..MAX_PARTS) { "invalid part number" }
        val answer = send("GET", "$base/${checked(sessionId)}/parts/$partNumber/url", emptyMap(), null)
        val fields = answer.jsonObject() ?: throw invalid(answer)
        val url = (fields["url"] as? String)?.takeIf { it.isNotEmpty() } ?: throw invalid(answer)
        return PartUrl(url, (fields["contentLength"] as? Long) ?: throw invalid(answer))
    }

    override fun complete(sessionId: String): FileState {
        val answer = send("POST", "$base/${checked(sessionId)}/complete", emptyMap(), ByteArray(0))
        val fields = answer.jsonObject() ?: throw invalid(answer)
        val file = fields["fileState"] as? String ?: throw invalid(answer)
        return FileState(file, fields["stateReasonCode"] as? String)
    }

    private fun checked(id: String): String {
        if (!IDENTIFIER.matches(id)) throw UploadFailure(Failure.Http(HTTP_BAD_REQUEST))
        return id
    }

    /** An answer that is not what the contract says: the status of the answer without a code (`needs_attention(unknown)` for a 2xx). */
    private fun invalid(answer: HttpResponse) = UploadFailure(Failure.Http(answer.status))

    private fun send(
        method: String,
        path: String,
        extra: Map<String, String>,
        body: ByteArray?,
    ): HttpResponse {
        val url: URL = core.config.apiUrl(path)
        var token = tokenOrFailure(session.accessToken())
        var repeated = false
        while (true) {
            val headers = clientHeaders(core.config) + extra + ("Authorization" to "Bearer $token")
            val answer = core.json(method, url, headers, body)
            when {
                answer.status in HTTP_OK_FROM..HTTP_OK_TO -> {
                    contact.contact(answer.dateMs)
                    return answer
                }

                answer.status == HTTP_UNAUTHORIZED -> {
                    when (val code = answer.problemCode()) {
                        "session_revoked" -> {
                            session.onApiRevoked()
                        }

                        "device_wipe_required" -> {
                            session.onApiWipeRequired()
                        }

                        else -> {
                            if (!repeated) {
                                // an access token that ended earlier than we thought: one refresh through the owner, one more try
                                repeated = true
                                token = tokenOrFailure(session.accessTokenRejected(token))
                                continue
                            } else {
                                throw UploadFailure(Failure.Http(HTTP_UNAUTHORIZED, code))
                            }
                        }
                    }
                    throw UploadFailure(Failure.Http(HTTP_UNAUTHORIZED, answer.problemCode()))
                }

                answer.status == HTTP_UPGRADE_REQUIRED -> {
                    session.onApiUpdateRequired()
                    throw UploadFailure(Failure.Http(HTTP_UPGRADE_REQUIRED, answer.problemCode()))
                }

                else -> {
                    val retryAfter = if (answer.status == HTTP_TOO_MANY) answer.retryAfterSeconds else null
                    throw UploadFailure(Failure.Http(answer.status, answer.problemCode(), retryAfter))
                }
            }
        }
    }

    /** An access token, or the failure the engine understands without a request being sent. */
    private fun tokenOrFailure(result: TokenResult): String =
        when (result) {
            is TokenResult.Ready -> result.accessToken
            TokenResult.RetryLater -> throw UploadFailure(Failure.Network)
            is TokenResult.Blocked -> throw blockedFailure(result.state)
        }

    private fun blockedFailure(state: SessionState): UploadFailure =
        when (state) {
            SessionState.WIPE_REQUIRED -> UploadFailure(Failure.Http(HTTP_UNAUTHORIZED, "device_wipe_required"))

            SessionState.PAUSED_UPDATE -> UploadFailure(Failure.Http(HTTP_UPGRADE_REQUIRED, "client_version_unsupported"))

            // signed out, needs a sign-in, revoked: the work waits for a full sign-in of the same owner
            else -> UploadFailure(Failure.Http(HTTP_UNAUTHORIZED, "session_revoked"))
        }

    private companion object {
        const val HTTP_OK_FROM = 200
        const val HTTP_OK_TO = 299
        const val HTTP_BAD_REQUEST = 400
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_UPGRADE_REQUIRED = 426
        const val HTTP_TOO_MANY = 429
    }
}

/**
 * The calls of the session without an access token: the rotation of the refresh token (`refreshMobileSession`) and the logout
 * (`mobileLogout`), with the same HTTP policy as the rest. The refresh token goes in the body only, never in an address or a header.
 */
class HttpAuthApi(
    private val core: HttpCore,
) : RefreshApi,
    LogoutApi {
    override fun refresh(refreshToken: String): RefreshAnswer {
        val probe = SendProbe()
        val answer =
            try {
                core.json(
                    "POST",
                    core.config.apiUrl("/api/v1/auth/mobile/token"),
                    clientHeaders(core.config) + ("Content-Type" to "application/json"),
                    jsonBody(mapOf("refreshToken" to refreshToken)),
                    probe,
                )
            } catch (error: UploadFailure) {
                // the request may have reached the server only when its first byte was written
                return if (probe.sent) RefreshAnswer.NoAnswer else RefreshAnswer.NotSent
            }
        return when (answer.status) {
            HTTP_OK -> success(answer) ?: RefreshAnswer.NoAnswer
            HTTP_UNAUTHORIZED -> if (answer.problemCode() == "device_wipe_required") RefreshAnswer.WipeRequired else RefreshAnswer.Revoked
            HTTP_FORBIDDEN -> RefreshAnswer.Forbidden
            HTTP_UPGRADE_REQUIRED -> RefreshAnswer.UpdateRequired
            else -> RefreshAnswer.NoAnswer
        }
    }

    override fun logout(accessToken: String): LogoutAnswer {
        val answer =
            try {
                core.json(
                    "POST",
                    core.config.apiUrl("/api/v1/auth/mobile/logout"),
                    clientHeaders(core.config) + ("Authorization" to "Bearer $accessToken"),
                    ByteArray(0),
                )
            } catch (error: UploadFailure) {
                return LogoutAnswer.UNAVAILABLE
            }
        return when {
            answer.status in HTTP_OK..HTTP_NO_CONTENT -> LogoutAnswer.DONE
            answer.status == HTTP_UNAUTHORIZED || answer.status == HTTP_FORBIDDEN -> LogoutAnswer.ALREADY_ENDED
            else -> LogoutAnswer.UNAVAILABLE
        }
    }

    /** The new pair of tokens; the lifetime of the access token is counted in the frame of the server (its `serverTime`), not of the phone. */
    private fun success(answer: HttpResponse): RefreshAnswer.Success? {
        val fields = answer.jsonObject() ?: return null
        val access = token(fields["accessToken"]) ?: return null
        val refresh = token(fields["refreshToken"]) ?: return null
        val now = Iso8601.parse(fields["serverTime"] as? String) ?: return null
        val until = Iso8601.parse(fields["accessTokenExpiresAt"] as? String) ?: return null
        return if (until > now) RefreshAnswer.Success(access, until - now, refresh, now) else null
    }

    private fun token(value: Any?): String? = (value as? String)?.takeIf { it.isNotEmpty() && it.length <= MAX_TOKEN_CHARS }

    private companion object {
        const val HTTP_OK = 200
        const val HTTP_NO_CONTENT = 204
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_UPGRADE_REQUIRED = 426
    }
}
