package expo.modules.spikeuploader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

// EVM-011 spike: one user-initiated data transfer (UIDT, Android 14+) job per file. The job is persisted (survives a reboot) and
// runs the native engine on its own thread; the extras carry only the asset id (no URLs, no token).
class UploadJobService : JobService() {
  private val running = ConcurrentHashMap<Int, AtomicBoolean>()

  override fun onStartJob(params: JobParameters): Boolean {
    val assetId = params.extras.getString("assetId") ?: return false
    if (!UUID_REGEX.matches(assetId)) return false
    val short = assetId.takeLast(8)
    Log.i("EVM011", "job start asset=$short job=${params.jobId}")
    if (Build.VERSION.SDK_INT >= 34) {
      setNotification(params, NOTIFICATION_ID, notification(this), JobService.JOB_END_NOTIFICATION_POLICY_DETACH)
    }
    val stop = AtomicBoolean(false)
    running[params.jobId] = stop
    Thread {
      val result = try {
        UploadEngine(applicationContext, stop).run(assetId)
      } catch (e: Throwable) {
        Log.w("EVM011", "engine crashed asset=$short type=${e.javaClass.simpleName}")
        Result.RETRY_LATER
      }
      running.remove(params.jobId)
      Log.i("EVM011", "job end asset=$short result=$result")
      try {
        jobFinished(params, result == Result.RETRY_LATER)
      } catch (e: Throwable) {
        // already stopped by the system
      }
    }.start()
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    val assetId = params.extras.getString("assetId")
    val reason = if (Build.VERSION.SDK_INT >= 31) params.stopReason else -1
    Log.i("EVM011", "job stop job=${params.jobId} reason=$reason")
    running[params.jobId]?.set(true)
    if (assetId != null && UUID_REGEX.matches(assetId)) {
      Jobs.update(applicationContext, assetId) {
        it.put("stops", it.optLong("stops") + 1).put("lastStopReason", reason)
      }
    }
    return true // reschedule
  }

  companion object {
    const val NOTIFICATION_ID = 4011
    private const val CHANNEL = "evm011_upload"

    fun notification(ctx: Context): Notification {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "EVM-011 spike upload", NotificationManager.IMPORTANCE_LOW))
      return Notification.Builder(ctx, CHANNEL)
        .setContentTitle("EVM-011 SPIKE")
        .setContentText("Uploading")
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setOngoing(true)
        .build()
    }

    /** Schedules (or replaces) the persisted UIDT job of one file. Must be called while the app is visible (Android 14+ rule). */
    fun schedule(ctx: Context, assetId: String, sizeBytes: Long): String {
      val scheduler = ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val extras = PersistableBundle().apply { putString("assetId", assetId) }
      val builder = JobInfo.Builder(Jobs.jobIdFor(assetId), ComponentName(ctx, UploadJobService::class.java))
        .setExtras(extras)
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setPersisted(true)
      if (Build.VERSION.SDK_INT >= 34) {
        builder.setUserInitiated(true).setEstimatedNetworkBytes(0, sizeBytes)
      }
      return try {
        if (scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS) "scheduled" else "schedule_failed"
      } catch (e: Exception) {
        Log.w("EVM011", "schedule rejected type=${e.javaClass.simpleName}")
        "schedule_rejected"
      }
    }

    fun isPending(ctx: Context, assetId: String): Boolean {
      val scheduler = ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      return scheduler.getPendingJob(Jobs.jobIdFor(assetId)) != null
    }
  }
}
