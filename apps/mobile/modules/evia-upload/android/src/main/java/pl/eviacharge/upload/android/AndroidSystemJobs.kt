package pl.eviacharge.upload.android

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import pl.eviacharge.upload.schedule.JobRequest
import pl.eviacharge.upload.schedule.NetworkRequirement
import pl.eviacharge.upload.schedule.ScheduleResult
import pl.eviacharge.upload.schedule.SystemJobs

/**
 * The port to `JobScheduler` (EVM-130 AC1; ADR-0020/0020a). It turns the [JobRequest] of the pure policy (`SchedulePolicy`, `JobArming`)
 * into a `JobInfo` and tells the system's answer; it decides nothing: the kind of the job (user-initiated on API 34+, regular otherwise
 * or after a `SecurityException`), the persistence and the network requirement all come from the request. The job carries only the
 * identifier of the asset (a UUID) in its extras. A job that needs a network never runs without one (a garage without signal).
 */
class AndroidSystemJobs(
  private val context: Context,
) : SystemJobs {
  private val scheduler: JobScheduler get() = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler

  override fun isPending(id: Int): Boolean =
    try {
      scheduler.getPendingJob(id) != null
    } catch (error: RuntimeException) {
      false
    }

  override fun schedule(request: JobRequest): ScheduleResult =
    try {
      val extras = PersistableBundle().apply { putString(EXTRA_ASSET_ID, request.assetId) }
      val builder = JobInfo.Builder(request.id, ComponentName(context, UploadJobService::class.java))
        .setExtras(extras)
        .setPersisted(request.spec.persisted)
        .setBackoffCriteria(BACKOFF_MS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
        .setRequiredNetworkType(
          when (request.spec.network) {
            NetworkRequirement.ANY -> JobInfo.NETWORK_TYPE_ANY
            NetworkRequirement.UNMETERED -> JobInfo.NETWORK_TYPE_UNMETERED
          },
        )
      if (request.spec.userInitiated && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        builder.setUserInitiated(true)
        builder.setEstimatedNetworkBytes(DOWNLOAD_ESTIMATE_BYTES, request.uploadBytes)
      }
      if (scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS) ScheduleResult.SCHEDULED else ScheduleResult.FAILED
    } catch (error: SecurityException) {
      // the system refuses a user-initiated job when the app is not visible enough; the pure policy asks again for a regular job
      if (request.spec.userInitiated) ScheduleResult.REFUSED_USER_INITIATED else ScheduleResult.FAILED
    } catch (error: RuntimeException) {
      ScheduleResult.FAILED
    }

  override fun cancel(id: Int) {
    try {
      scheduler.cancel(id)
    } catch (error: RuntimeException) {
      // already gone
    }
  }

  companion object {
    /** The only extra of a job: the asset (a UUID). No token, address, path or name. */
    const val EXTRA_ASSET_ID = "assetId"
    private const val BACKOFF_MS = 30_000L
    private const val DOWNLOAD_ESTIMATE_BYTES = 64L * 1024
  }
}
