package pl.eviacharge.upload.http

import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadFailure
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

private val RETRY_AFTER = Regex("^[0-9]{1,7}$")
private const val READ_CHUNK = 8192

/** An answer of the API: [body] is `null` when it was longer than the limit (the caller treats such an answer as invalid). */
class HttpResponse(
    val status: Int,
    val body: ByteArray?,
    /** `Retry-After` in delta-seconds; an HTTP date or a bad value gives `null`. */
    val retryAfterSeconds: Long?,
    /** `Date` of the answer (epoch ms), when it is valid. */
    val dateMs: Long?,
)

/** Set when the first byte of the request may have left the device: a failure before it leaves the token of a refresh untouched. */
class SendProbe {
    @Volatile
    var sent = false
}

/**
 * The one HTTP client policy of the module (ADR-0020, security 4): `HttpURLConnection` with redirects off, https only, the system trust
 * store (no own `TrustManager` or `HostnameVerifier`), time limits, a limit of the answer, `Authorization` only for the API host.
 * Used by the adapters of the API, of the token refresh and of the parts. One instance serves one job thread.
 */
class HttpCore(
    val config: HttpConfig,
    private val cancel: CancelHandle,
    private val stop: StopCheck,
) {
    /**
     * The mapping of failures: a timeout is [Failure.Network]; an interrupt, the flag of the thread, a closed connection after
     * [CancelHandle.cancel] and a set wipe marker are [UploadCancelledException], NEVER [Failure.Network].
     */
    fun <T> guard(block: () -> T): T {
        if (cancelled()) throw UploadCancelledException()
        try {
            return block()
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            throw UploadCancelledException()
        } catch (error: SocketTimeoutException) {
            if (cancelled()) throw UploadCancelledException()
            throw UploadFailure(Failure.Network)
        } catch (error: InterruptedIOException) {
            Thread.currentThread().interrupt()
            throw UploadCancelledException()
        } catch (error: IOException) {
            if (cancelled()) throw UploadCancelledException()
            throw UploadFailure(Failure.Network)
        }
    }

    private fun cancelled() = cancel.cancelled || Thread.currentThread().isInterrupted || stop.isStopped()

    /** A connection with the policy applied; nothing is sent yet. */
    fun open(
        url: URL,
        method: String,
    ): HttpURLConnection {
        val connection = url.openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = config.connectTimeoutMs
        connection.readTimeout = config.readTimeoutMs
        connection.useCaches = false
        connection.requestMethod = method
        return connection
    }

    /** Registers the connection for the stop of the job; runs [block]; always closes the connection. */
    fun <T> using(
        connection: HttpURLConnection,
        block: (HttpURLConnection) -> T,
    ): T {
        cancel.attach(connection)
        try {
            return block(connection)
        } finally {
            cancel.detach()
            connection.disconnect()
        }
    }

    /**
     * One request with a small JSON body (or none: `null`; an empty array sends `Content-Length: 0`). The answer is read up to the limit.
     * `Authorization` goes only to the host of the API.
     */
    fun json(
        method: String,
        url: URL,
        headers: Map<String, String>,
        body: ByteArray?,
        probe: SendProbe? = null,
    ): HttpResponse {
        require(
            !headers.keys.any { it.equals("Authorization", ignoreCase = true) } || config.isApiUrl(url),
        ) { "authorization only for the api" }
        return guard {
            using(open(url, method)) { connection ->
                headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
                // A small body is buffered by the client and sent with its Content-Length. Streaming mode is NOT used here: with it
                // the JDK drops the connection (and the error body with the problem `code`) on a 401.
                if (body != null) connection.doOutput = true
                // The connection (TCP and TLS) is made first: a failure here means that no byte of the request left the device.
                connection.connect()
                probe?.sent = true
                if (body != null) connection.outputStream.use { it.write(body) }
                answer(connection)
            }
        }
    }

    /** The status, the useful headers and the body of an answer read up to [HttpConfig.maxJsonBytes]. */
    fun answer(connection: HttpURLConnection): HttpResponse {
        val status = connection.responseCode
        val stream = if (status >= HTTP_ERROR) connection.errorStream else connection.inputStream
        val body = if (stream == null) ByteArray(0) else stream.use { readLimited(it, config.maxJsonBytes) }
        val date = connection.getHeaderFieldDate("Date", -1L).takeIf { it >= 0 }
        return HttpResponse(status, body, retryAfter(connection), date)
    }

    /** `Retry-After` in delta-seconds; an HTTP date, a sign or a long number gives `null` (the engine then uses its own backoff). */
    fun retryAfter(connection: HttpURLConnection): Long? =
        connection
            .getHeaderField("Retry-After")
            ?.trim()
            ?.takeIf { RETRY_AFTER.matches(it) }
            ?.toLong()

    companion object {
        private const val HTTP_ERROR = 400

        /** The bytes of the stream, or `null` when there are more than [max]. */
        fun readLimited(
            stream: InputStream,
            max: Int,
        ): ByteArray? {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(READ_CHUNK)
            var total = 0
            while (true) {
                val read = stream.read(buffer, 0, minOf(buffer.size, max + 1 - total))
                if (read < 0) return out.toByteArray()
                out.write(buffer, 0, read)
                total += read
                if (total > max) return null
            }
        }
    }
}
