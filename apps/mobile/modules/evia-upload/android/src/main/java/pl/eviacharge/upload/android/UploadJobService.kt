package pl.eviacharge.upload.android

import android.app.job.JobParameters
import android.app.job.JobService
import android.os.Build
import pl.eviacharge.upload.files.UploadFiles
import pl.eviacharge.upload.notification.JobNotification
import pl.eviacharge.upload.notification.NotificationPlanner
import pl.eviacharge.upload.runner.JobOutcomes

/**
 * The job of the system that uploads ONE file (EVM-130 AC1, AC2, AC5, AC6; ADR-0020/0020a): a user-initiated data transfer on Android 14+
 * while the app is visible, a regular job with a network constraint otherwise. Declared by `plugins/with-upload.ts`: not exported, bound by
 * the system only (`BIND_JOB_SERVICE`), in the DEFAULT process (so it shares the one `TokenOwner` and its lock with the app), not
 * direct-boot aware, not a foreground service.
 *
 * This class has no logic of its own: `onStartJob` starts a worker thread that calls the pure `UploadWorker` (which checks the wipe
 * marker and the owner of the job BEFORE any request, runs the engine and never throws) and `onStopJob` calls its stop (interrupt of the
 * thread AND `disconnect()` of the active connection, because an interrupt does not unblock the I/O of `HttpURLConnection`). Everything
 * is caught: nothing escapes to `AndroidRuntime`, which would print a stack with an address into logcat (security 5, SR-LOG-02).
 * Several jobs (one per file) run in one instance of the service: no per-job state is kept in fields.
 */
class UploadJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean =
    try {
      start(params)
    } catch (error: Throwable) {
      false
    }

  override fun onStopJob(params: JobParameters): Boolean =
    try {
      val assetId = assetOf(params)
      if (assetId == null) false else UploadRuntime.get(applicationContext).worker.onStop(assetId)
    } catch (error: Throwable) {
      false
    }

  private fun assetOf(params: JobParameters): String? =
    params.extras.getString(AndroidSystemJobs.EXTRA_ASSET_ID)?.takeIf { UploadFiles.isAssetId(it) }

  private fun start(params: JobParameters): Boolean {
    val assetId = assetOf(params) ?: return false
    val runtime = UploadRuntime.get(applicationContext)
    val userInitiated = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && params.isUserInitiatedJob
    val thread = Thread({ work(runtime, params, assetId, userInitiated) }, "evia-upload")
    // registered before the thread starts: a stop that arrives at once still reaches the job
    runtime.worker.begin(assetId, thread)
    announce(runtime, params, userInitiated, NotificationPlanner.forJob(runtime.worker.notice(), userInitiated))
    try {
      thread.start()
    } catch (error: Throwable) {
      runtime.worker.abandon(assetId, thread)
      return false
    }
    return true
  }

  private fun work(
    runtime: UploadRuntime,
    params: JobParameters,
    assetId: String,
    userInitiated: Boolean,
  ) {
    var reschedule = false
    try {
      reschedule = JobOutcomes.wantsReschedule(runtime.worker.execute(assetId))
      announce(runtime, params, userInitiated, NotificationPlanner.forJob(runtime.worker.notice(), userInitiated))
    } catch (error: Throwable) {
      // a failure of the notification never changes what the job reports to the system
    } finally {
      try {
        jobFinished(params, reschedule)
      } catch (error: Throwable) {
        // the system no longer knows the job
      }
    }
  }

  /**
   * The notification of the job: a user-initiated job must have one while it runs (`setNotification`; the policy keeps a closing state
   * after the job and removes a progress text), a regular job shows it as an ordinary notification when the user allowed them.
   */
  private fun announce(
    runtime: UploadRuntime,
    params: JobParameters,
    userInitiated: Boolean,
    plan: JobNotification,
  ) {
    try {
      if (userInitiated && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val policy = if (plan.keepAfterJob) JOB_END_NOTIFICATION_POLICY_DETACH else JOB_END_NOTIFICATION_POLICY_REMOVE
        setNotification(params, UploadNotifications.NOTIFICATION_ID, runtime.notifications.build(plan.notice), policy)
      } else if (plan.withdraw) {
        runtime.notifications.cancel()
      } else {
        runtime.notifications.post(plan.notice)
      }
    } catch (error: Throwable) {
      // no notification (not allowed, the system refused): the upload goes on
    }
  }
}
