package expo.modules.spikeuploader

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.StatFs
import android.util.Log
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID

// EVM-011 spike module. JS owns the queue database (SQLCipher); this module owns files, hashing, the job files and the UIDT jobs.
// Intent extras (adb am start -e ...) are the spike's remote control: configure (token never leaves native code), enqueue, ...
class SpikeUploaderModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun mediaDir(): File = File(ctx.filesDir, "media").also { it.mkdirs() }

  private fun inside(dir: File, f: File): Boolean = f.canonicalPath.startsWith(dir.canonicalPath + File.separator)

  /** Reads the remote-control extras once. "configure" is handled here so the token never reaches JS or logs. */
  private fun consume(intent: Intent?): Map<String, String>? {
    val cmd = intent?.getStringExtra("evm011_cmd") ?: return null
    intent.removeExtra("evm011_cmd")
    if (cmd == "configure") {
      val token = intent.getStringExtra("evm011_token")
      intent.removeExtra("evm011_token")
      val base = intent.getStringExtra("evm011_base")
      val device = intent.getStringExtra("evm011_device")
      if (token != null && base != null && device != null) {
        try {
          ConfigStore.save(ctx, base, device, token)
          Log.i("EVM011", "configured")
        } catch (e: Exception) {
          Log.w("EVM011", "configure rejected type=${e.javaClass.simpleName}")
        }
      }
      return mapOf("cmd" to "configured")
    }
    val allowed = setOf("enqueue", "reschedule", "confirm")
    if (cmd !in allowed) return null
    val out = mutableMapOf("cmd" to cmd)
    for (k in listOf("path", "type", "asset", "sha", "flag")) intent.getStringExtra("evm011_$k")?.let { out[k] = it }
    return out
  }

  override fun definition() = ModuleDefinition {
    Name("SpikeUploader")
    Events("onCommand")

    OnNewIntent { intent ->
      consume(intent)?.let { sendEvent("onCommand", bundleOf(*it.entries.map { e -> e.key to e.value }.toTypedArray())) }
    }

    Function("getLaunchCommand") { consume(appContext.currentActivity?.intent) }

    Function("hasConfig") { ConfigStore.hasConfig(ctx) }

    Function("deviceInfo") {
      mapOf("sdk" to Build.VERSION.SDK_INT, "release" to Build.VERSION.RELEASE, "model" to Build.MODEL, "patch" to Build.VERSION.SECURITY_PATCH)
    }

    AsyncFunction("freeBytes") { StatFs(ctx.filesDir.path).availableBytes.toDouble() }

    // Moves a camera result (cache) into the app-private media directory; no MediaStore, no gallery (MASVS-PRIVACY-1).
    AsyncFunction("moveToSandbox") { src: String ->
      val from = File(src.removePrefix("file://"))
      require(inside(ctx.cacheDir, from)) { "source outside the cache" }
      val ext = from.extension.lowercase().takeIf { it in setOf("jpg", "jpeg", "mp4", "mov") } ?: "bin"
      val dest = File(mediaDir(), "${UUID.randomUUID()}.$ext")
      if (!from.renameTo(dest)) {
        from.copyTo(dest)
        from.delete()
      }
      RandomAccessFile(dest, "rw").use { it.fd.sync() }
      mapOf("path" to dest.path, "size" to dest.length().toDouble())
    }

    // Streaming SHA-256 (1 MiB chunks): a 500 MB file never goes through the JS bridge.
    AsyncFunction("sha256File") { path: String ->
      val f = File(path)
      require(inside(mediaDir(), f)) { "path outside the media directory" }
      val md = MessageDigest.getInstance("SHA-256")
      f.inputStream().use { input ->
        val buf = ByteArray(1024 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          md.update(buf, 0, n)
        }
      }
      md.digest().joinToString("") { "%02x".format(it) }
    }

    AsyncFunction("registerJob") { assetId: String, path: String, sha256: String, contentType: String, killAfterComplete: Boolean ->
      require(UUID_REGEX.matches(assetId)) { "invalid asset id" }
      require(Regex("^[0-9a-f]{64}$").matches(sha256)) { "invalid sha256" }
      require(contentType == "image/jpeg" || contentType == "video/mp4") { "invalid type" }
      val f = File(path)
      require(inside(mediaDir(), f) && f.exists()) { "invalid path" }
      if (Jobs.read(ctx, assetId) == null) {
        val job = org.json.JSONObject()
          .put("assetId", assetId).put("filePath", f.path).put("size", f.length()).put("sha256", sha256)
          .put("contentType", contentType).put("state", Jobs.QUEUED).put("createdAt", System.currentTimeMillis())
        if (killAfterComplete) job.put("testKillAfterComplete", true)
        Jobs.write(ctx, job)
      }
      f.length().toDouble()
    }

    // Schedules the persisted UIDT job. Call on a user action (the app must be visible on Android 14+).
    AsyncFunction("scheduleUpload") { assetId: String ->
      val job = Jobs.read(ctx, assetId) ?: return@AsyncFunction "unknown_job"
      if (Jobs.isFinal(job.getString("state"))) return@AsyncFunction "final"
      UploadJobService.schedule(ctx, assetId, job.getLong("size"))
    }

    // After a force-stop the system has cancelled our jobs: re-create the missing ones (called when the app is opened).
    AsyncFunction("ensureScheduled") {
      var n = 0
      for (job in Jobs.all(ctx)) {
        val id = job.getString("assetId")
        if (Jobs.isFinal(job.getString("state")) || UploadJobService.isPending(ctx, id)) continue
        if (UploadJobService.schedule(ctx, id, job.getLong("size")) == "scheduled") n++
      }
      n
    }

    AsyncFunction("getJobs") {
      Jobs.all(ctx).map { j ->
        val id = j.getString("assetId")
        val etags = j.optJSONObject("etags")
        val partsDone = etags?.length() ?: 0
        val partSize = j.optLong("partSize")
        val inFlight = Progress.inFlight[id] ?: 0L
        val size = j.getLong("size")
        val done = if (j.getString("state") == Jobs.UPLOADED) size else minOf(size, partsDone * partSize + inFlight)
        mapOf(
          "assetId" to id, "state" to j.getString("state"), "size" to size.toDouble(), "bytesDone" to done.toDouble(),
          "partCount" to j.optInt("partCount"), "partsDone" to partsDone, "retries" to j.optLong("retries").toDouble(),
          "renewals" to j.optLong("renewals").toDouble(), "partPuts" to j.optLong("partPuts").toDouble(),
          "skippedParts" to j.optLong("skippedParts").toDouble(), "stops" to j.optLong("stops").toDouble(),
          "runs" to j.optLong("runs").toDouble(), "startedAt" to j.optLong("startedAt").toDouble(),
          "finishedAt" to j.optLong("finishedAt").toDouble(), "sha256" to j.getString("sha256"),
          "pending" to UploadJobService.isPending(ctx, id), "lastError" to j.optString("lastError", ""),
        )
      }
    }

    // Local original is removed only after the server side is confirmed: state uploaded AND a matching SHA-256 of the stored object.
    AsyncFunction("confirmAndDelete") { assetId: String, remoteSha256: String ->
      val job = Jobs.read(ctx, assetId) ?: return@AsyncFunction false
      if (job.getString("state") != Jobs.UPLOADED || remoteSha256 != job.getString("sha256")) return@AsyncFunction false
      File(job.getString("filePath")).delete()
      Jobs.update(ctx, assetId) { it.put("localDeleted", true) }
      true
    }
  }
}
