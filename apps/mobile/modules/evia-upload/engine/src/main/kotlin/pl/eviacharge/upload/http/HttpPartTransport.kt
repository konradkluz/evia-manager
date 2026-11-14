package pl.eviacharge.upload.http

import pl.eviacharge.upload.CancelHandle
import pl.eviacharge.upload.Failure
import pl.eviacharge.upload.OriginalMissingException
import pl.eviacharge.upload.PartRequest
import pl.eviacharge.upload.PartTransport
import pl.eviacharge.upload.StopCheck
import pl.eviacharge.upload.UploadCancelledException
import pl.eviacharge.upload.UploadFailure
import pl.eviacharge.upload.isTrustedPartUrl
import java.io.File
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.URL

private const val CHUNK_BYTES = 64 * 1024
private const val STOP_CHECK_EVERY_BYTES = 1024 * 1024L
private const val HTTP_OK_FROM = 200
private const val HTTP_OK_TO = 299
private const val HTTP_TOO_MANY = 429

/**
 * `PUT` of one part to the storage (ADR-0020, security 4): the address is checked again against the hosts of the build, the request
 * carries only `Content-Length` (a fixed length, never chunked, and never `Authorization`), redirects are off, the bytes come from
 * the original of the job straight from the file (no copy, nothing passes through JavaScript). A part is read in chunks, so the
 * stop of the job (the cancel handle, the interrupt flag, the wipe marker) takes effect in the middle of a part. When the original is
 * gone or too short, the work ends with [OriginalMissingException] — no failure, no path.
 */
class HttpPartTransport(
    private val core: HttpCore,
    private val cancel: CancelHandle,
    private val stop: StopCheck,
    private val original: File,
) : PartTransport {
    override fun put(request: PartRequest): String? {
        val config = core.config
        if (!isTrustedPartUrl(request.url, config.storageHosts, config.e2eCleartext)) throw UploadFailure(Failure.Http(HTTP_BAD_REQUEST))
        if (!original.isFile || original.length() < request.offset + request.length) throw OriginalMissingException()
        return core.guard {
            core.using(core.open(URL(request.url), "PUT")) { connection ->
                // `Content-Length` of the plan is the only header: the signature of the address does not cover more
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(request.length)
                connection.outputStream.use { sink -> copyPart(sink, request) }
                val status = connection.responseCode
                if (status !in HTTP_OK_FROM..HTTP_OK_TO) {
                    val retryAfter = if (status == HTTP_TOO_MANY) core.retryAfter(connection) else null
                    throw UploadFailure(Failure.Http(status, null, retryAfter))
                }
                connection.getHeaderField("ETag")
            }
        }
    }

    private fun copyPart(
        sink: OutputStream,
        request: PartRequest,
    ) {
        RandomAccessFile(original, "r").use { file ->
            file.seek(request.offset)
            val buffer = ByteArray(CHUNK_BYTES)
            var left = request.length
            var sinceCheck = 0L
            while (left > 0) {
                if (cancel.cancelled || Thread.currentThread().isInterrupted) throw UploadCancelledException()
                val read = file.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                if (read < 0) throw OriginalMissingException()
                sink.write(buffer, 0, read)
                left -= read
                sinceCheck += read
                if (sinceCheck >= STOP_CHECK_EVERY_BYTES) {
                    sinceCheck = 0
                    if (stop.isStopped()) throw UploadCancelledException()
                }
            }
        }
    }

    private companion object {
        const val HTTP_BAD_REQUEST = 400
    }
}
