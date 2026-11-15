package pl.eviacharge.upload.android

import android.Manifest
import android.R as AndroidR
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import pl.eviacharge.upload.notification.Notice
import pl.eviacharge.upload.notification.NotificationText

/**
 * The notification of the upload (EVM-130 AC6; makieta 09, SR-MOB-07/08, MASVS-PLATFORM-1/3). The TEXTS come from the pure
 * `NotificationText` (counts only: no order numbers, names, addresses or thumbnails); this class only builds the platform object:
 * - the channel "Wysyłanie plików": low importance (no sound, no vibration), private on the lock screen, with a PUBLIC version that says
 *   only "EVia Manager";
 * - the tap opens the app with an EXPLICIT `PendingIntent` (component of the launcher activity, no action, `FLAG_IMMUTABLE`), carrying
 *   one extra from a fixed set ([TARGET_QUEUE]; navigation only, the app takes it through the lock screen of the app); no action buttons;
 * - without the permission of Android 13+ nothing is posted - the job works all the same.
 */
class UploadNotifications(
  private val context: Context,
) {
  private val manager: NotificationManager get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /** `true` when a notification may be shown now (Android 13+: the permission; every version: not switched off in the settings). */
  fun canPost(): Boolean =
    try {
      val permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      permitted && manager.areNotificationsEnabled()
    } catch (error: RuntimeException) {
      false
    }

  /** The notification for [notice] (also the one of a user-initiated job, which the system requires while the job runs). */
  fun build(notice: Notice): Notification {
    ensureChannel()
    val builder = newBuilder()
      .setSmallIcon(AndroidR.drawable.stat_sys_upload)
      .setContentTitle(NotificationText.PUBLIC_TITLE)
      .setContentText(notice.text)
      .setOngoing(notice.ongoing)
      .setOnlyAlertOnce(true)
      .setAutoCancel(!notice.ongoing)
      .setShowWhen(false)
      .setCategory(if (notice.ongoing) Notification.CATEGORY_PROGRESS else Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setPublicVersion(
        newBuilder()
          .setSmallIcon(AndroidR.drawable.stat_sys_upload)
          .setContentTitle(NotificationText.PUBLIC_TITLE)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .build(),
      )
    openIntent()?.let { builder.setContentIntent(it) }
    return builder.build()
  }

  /** Shows [notice] as an ordinary notification (a regular job, or the closing state after a user-initiated one); `false` when not allowed. */
  fun post(notice: Notice): Boolean {
    if (!canPost()) return false
    return try {
      manager.notify(NOTIFICATION_ID, build(notice))
      true
    } catch (error: RuntimeException) {
      false
    }
  }

  fun cancel() {
    try {
      manager.cancel(NOTIFICATION_ID)
    } catch (error: RuntimeException) {
      // nothing to cancel
    }
  }

  private fun newBuilder(): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
    }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, NotificationText.CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannel(channel)
  }

  /** Explicit intent to the launcher activity of this app: the component comes from the package manager, the intent has no action. */
  private fun openIntent(): PendingIntent? {
    val component = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component ?: return null
    val intent = Intent().setComponent(component).putExtra(EXTRA_TARGET, TARGET_QUEUE)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  companion object {
    const val CHANNEL_ID = "evia_upload"

    /** One notification for the whole upload: the jobs of the files share it (the counts say "3 z 12 plików"). */
    const val NOTIFICATION_ID = 0x45564c01

    /** The extra of the intent of the notification and the fixed set of its values: navigation only. */
    const val EXTRA_TARGET = "pl.eviacharge.upload.OPEN"
    const val TARGET_QUEUE = "queue"
    val TARGETS: Set<String> = setOf(TARGET_QUEUE)
  }
}
