package expo.modules.spikeuploader

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

// EVM-011 spike: native implementation of the upload protocol (the TypeScript engine in core/ is the reference + test oracle).
// Runs inside a UIDT job without any JS. One job per file, parts sequentially, bytes read straight from the source file range.
// Rules: ListParts is the source of truth; ETag written to the job file right after each part; 403 on a part = renew its URL;
// 401 session_revoked = pause and delete nothing. Logs carry asset id prefix, part numbers, sizes, times and status codes only.

private const val TAG = "EVM011"

object Progress {
  /** Bytes sent of the part in flight, per asset (in memory only; UI polling). */
  val inFlight = ConcurrentHashMap<String, Long>()
}

class StoppedException : Exception()
class NetworkException(cause: Throwable?) : Exception(cause)
class ApiException(val status: Int, val code: String) : Exception("api $status $code")
class PartHttpException(val status: Int) : Exception("part http $status")

enum class Result { OK, RETRY_LATER, PAUSED_REVOKED, FAILED }

class UploadEngine(private val ctx: Context, private val stop: AtomicBoolean) {
  companion object {
    const val MAX_ATTEMPTS_PER_PART = 6
    const val MAX_RENEWALS_PER_PART = 3
    const val BACKOFF_BASE_MS = 1000L
    const val BACKOFF_CAP_MS = 30_000L
  }

  private fun checkStop() {
    if (stop.get()) throw StoppedException()
  }

  private fun sleepInterruptible(ms: Long) {
    var left = ms
    while (left > 0) {
      checkStop()
      val step = minOf(left, 100L)
      Thread.sleep(step)
      left -= step
    }
  }

  private fun backoff(attempt: Int) {
    val ceiling = minOf(BACKOFF_CAP_MS, BACKOFF_BASE_MS shl attempt.coerceAtMost(10))
    sleepInterruptible((Math.random() * ceiling).toLong())
  }

  private fun api(cfg: Config, method: String, path: String, body: JSONObject? = null): JSONObject {
    val conn = URL(cfg.baseUrl + path).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = 15_000
      conn.readTimeout = 60_000
      conn.setRequestProperty("Authorization", "Bearer " + cfg.token)
      conn.setRequestProperty("X-Device-Id", cfg.deviceId)
      conn.setRequestProperty("Content-Type", "application/json")
      if (body != null) {
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      val code = conn.responseCode
      val stream = if (code >= 400) conn.errorStream else conn.inputStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
      val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
      if (code >= 400) throw ApiException(code, json.optString("error", "error"))
      return json
    } catch (e: IOException) {
      throw NetworkException(e)
    } finally {
      conn.disconnect()
    }
  }

  /** PUT of one file range to a signed URL; Content-Length is fixed (and signed by the issuer). Returns the ETag. */
  private fun putPart(url: String, file: File, offset: Long, length: Long, assetId: String): String {
    val conn = URL(url).openConnection() as HttpURLConnection
    var sent = 0L
    try {
      conn.requestMethod = "PUT"
      conn.doOutput = true
      conn.connectTimeout = 15_000
      conn.readTimeout = 60_000
      conn.setFixedLengthStreamingMode(length)
      RandomAccessFile(file, "r").use { raf ->
        raf.seek(offset)
        conn.outputStream.use { out ->
          val buf = ByteArray(64 * 1024)
          while (sent < length) {
            checkStop()
            val n = raf.read(buf, 0, minOf(buf.size.toLong(), length - sent).toInt())
            if (n < 0) throw IOException("unexpected end of file")
            out.write(buf, 0, n)
            sent += n
            Progress.inFlight[assetId] = sent
          }
        }
      }
      val code = conn.responseCode
      if (code !in 200..299) {
        conn.errorStream?.close()
        throw PartHttpException(code)
      }
      conn.inputStream?.close()
      return conn.getHeaderField("ETag") ?: throw IOException("missing etag")
    } catch (e: IOException) {
      val job = Jobs.read(ctx, assetId)
      if (job != null) {
        job.put("retransmittedBytes", job.optLong("retransmittedBytes") + sent)
        Jobs.write(ctx, job)
      }
      throw NetworkException(e)
    } catch (e: PartHttpException) {
      if (e.status != 403) {
        val job = Jobs.read(ctx, assetId)
        if (job != null) {
          job.put("retransmittedBytes", job.optLong("retransmittedBytes") + sent)
          Jobs.write(ctx, job)
        }
      }
      throw e
    } finally {
      conn.disconnect()
      Progress.inFlight.remove(assetId)
    }
  }

  private fun inc(job: JSONObject, key: String, by: Long = 1) {
    job.put(key, job.optLong(key) + by)
  }

  fun run(assetId: String): Result {
    val job = Jobs.read(ctx, assetId) ?: return Result.FAILED
    if (job.getString("state") == Jobs.UPLOADED) return Result.OK
    val cfg = try { ConfigStore.read(ctx) } catch (e: Exception) { null }
    if (cfg == null) {
      job.put("lastError", "no_config")
      Jobs.write(ctx, job)
      return Result.FAILED
    }
    val file = File(job.getString("filePath"))
    if (!file.exists()) {
      job.put("state", Jobs.FAILED).put("lastError", "file_missing")
      Jobs.write(ctx, job)
      return Result.FAILED
    }
    val short = assetId.substring(0, 8)
    if (job.optLong("startedAt") == 0L) job.put("startedAt", System.currentTimeMillis())
    inc(job, "runs")
    try {
      val size = job.getLong("size")
      val session = api(
        cfg, "POST", "/v1/uploads",
        JSONObject().put("assetId", assetId).put("size", size).put("sha256", job.getString("sha256"))
          .put("contentType", job.getString("contentType")).put("deviceId", cfg.deviceId)
      )
      val partSize = session.getLong("partSize")
      val partCount = session.getInt("partCount")
      job.put("uploadId", session.getString("uploadId")).put("partSize", partSize).put("partCount", partCount)
      job.put("state", Jobs.UPLOADING)
      Jobs.write(ctx, job)

      val listed = api(cfg, "GET", "/v1/uploads/$assetId/parts")
      if (listed.optBoolean("completed")) return markUploaded(job, short)
      val etags = JSONObject()
      val parts: JSONArray = listed.getJSONArray("parts")
      for (i in 0 until parts.length()) etags.put(parts.getJSONObject(i).getInt("number").toString(), parts.getJSONObject(i).getString("etag"))
      job.put("etags", etags)
      Jobs.write(ctx, job)

      for (n in 1..partCount) {
        checkStop()
        if (etags.has(n.toString())) {
          inc(job, "skippedParts")
          continue
        }
        val offset = (n - 1) * partSize
        val length = minOf(partSize, size - offset)
        var attempt = 0
        var renewals = 0
        val started = System.currentTimeMillis()
        while (true) {
          checkStop()
          try {
            val url = api(cfg, "GET", "/v1/uploads/$assetId/parts/$n/url").getString("url")
            val etag = putPart(url, file, offset, length, assetId)
            etags.put(n.toString(), etag)
            inc(job, "partPuts")
            job.put("etags", etags)
            Jobs.write(ctx, job)
            Log.i(TAG, "part done asset=$short part=$n bytes=$length ms=${System.currentTimeMillis() - started}")
            break
          } catch (e: PartHttpException) {
            if (e.status == 403) {
              renewals++
              inc(job, "renewals")
              if (renewals > MAX_RENEWALS_PER_PART) throw ApiException(403, "url_renewal_exhausted")
              Log.i(TAG, "part url renewed asset=$short part=$n")
              continue
            }
            attempt++
            inc(job, "retries")
            if (attempt >= MAX_ATTEMPTS_PER_PART) {
              Jobs.write(ctx, job)
              return Result.RETRY_LATER
            }
            backoff(attempt - 1)
          } catch (e: NetworkException) {
            attempt++
            inc(job, "retries")
            Jobs.write(ctx, job)
            Log.i(TAG, "part network error asset=$short part=$n attempt=$attempt")
            if (attempt >= MAX_ATTEMPTS_PER_PART) return Result.RETRY_LATER
            backoff(attempt - 1)
          }
        }
      }

      val list = JSONArray()
      for (n in 1..partCount) list.put(JSONObject().put("number", n).put("etag", etags.getString(n.toString())))
      val completeStart = System.currentTimeMillis()
      api(cfg, "POST", "/v1/uploads/$assetId/complete", JSONObject().put("parts", list))
      Log.i(TAG, "complete ok asset=$short ms=${System.currentTimeMillis() - completeStart}")
      // A kill exactly here leaves the local state "uploading"; the next run is an idempotent no-op for the server.
      if (job.optBoolean("testKillAfterComplete")) {
        Log.w(TAG, "test hook: killing the process after complete asset=$short")
        android.os.Process.killProcess(android.os.Process.myPid())
      }
      return markUploaded(job, short)
    } catch (e: StoppedException) {
      Jobs.write(ctx, job)
      Log.i(TAG, "stopped asset=$short")
      return Result.RETRY_LATER
    } catch (e: NetworkException) {
      Jobs.write(ctx, job)
      return Result.RETRY_LATER
    } catch (e: ApiException) {
      if (e.code == "session_revoked") {
        job.put("state", Jobs.PAUSED_REVOKED)
        Jobs.write(ctx, job)
        return Result.PAUSED_REVOKED
      }
      job.put("lastError", e.code)
      if (e.status >= 500) {
        Jobs.write(ctx, job)
        return Result.RETRY_LATER
      }
      if (e.code == "id_conflict" || e.status in 400..499) job.put("state", Jobs.FAILED)
      Jobs.write(ctx, job)
      return Result.FAILED
    }
  }

  private fun markUploaded(job: JSONObject, short: String): Result {
    job.put("state", Jobs.UPLOADED).put("finishedAt", System.currentTimeMillis())
    Jobs.write(ctx, job)
    Log.i(TAG, "uploaded asset=$short total_ms=${job.getLong("finishedAt") - job.optLong("startedAt")}")
    return Result.OK
  }
}
