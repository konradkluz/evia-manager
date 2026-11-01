package pl.eviacharge.clipboard

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Sensitive clipboard of the app (EVM-107 AC4; MASVS-PLATFORM-3, security S1): the copy of a rejected entry's text is marked
 * `EXTRA_IS_SENSITIVE` (Android 13+ hides the preview; the key string on older versions) and is removed after the time given by
 * the caller - by a native `Handler`, because JavaScript timers stop in the background.
 * Since Android 10 an app without focus cannot read the clipboard, so "unchanged" is not tested by reading but by a flag raised by
 * `OnPrimaryClipChangedListener` when somebody else replaced the clip. Nothing is logged and the text never leaves this class.
 * Best effort: if the system kills the process before the time is up, the copy stays until the system clears it (Android 13+).
 * The module declares no component (service, receiver, provider) and needs no permission.
 */
class EviaClipboardModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var label: String? = null
  private var deadlineElapsed: Long = 0
  private var replacedByOther = false
  private var expectingOwnChange = false
  private var listening = false
  private val timeout = Runnable { removeOwnCopy() }
  private val listener = ClipboardManager.OnPrimaryClipChangedListener {
    if (label == null) return@OnPrimaryClipChangedListener
    if (expectingOwnChange) expectingOwnChange = false else replacedByOther = true
  }

  private fun manager(): ClipboardManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
  }

  private fun listen(manager: ClipboardManager) {
    if (!listening) {
      manager.addPrimaryClipChangedListener(listener)
      listening = true
    }
  }

  /** Removes the copy of this module: unconditionally while nobody replaced it (fail-safe: privacy before convenience). */
  private fun removeOwnCopy() {
    handler.removeCallbacks(timeout)
    val own = label ?: return
    val manager = manager()
    try {
      if (manager != null && !replacedByOther) {
        // with focus the label is readable: never clear a clip that is not ours
        val current = manager.primaryClipDescription?.label?.toString()
        if (current == null || current == own) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.clearPrimaryClip()
          } else {
            manager.setPrimaryClip(ClipData.newPlainText("", ""))
          }
        }
      }
    } catch (_: Throwable) {
      // nothing to report and nothing to log
    }
    label = null
    replacedByOther = false
    expectingOwnChange = false
  }

  override fun definition() = ModuleDefinition {
    Name("EviaClipboard")

    /** Puts the text on the clipboard as sensitive and schedules its removal; `false` when the system refuses. */
    Function("copySensitive") { text: String, ttlMs: Int ->
      val manager = manager() ?: return@Function false
      try {
        removeOwnCopy()
        listen(manager)
        val own = "evia-" + UUID.randomUUID().toString()
        val clip = ClipData.newPlainText(own, text)
        val extras = PersistableBundle()
        val key = if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE"
        extras.putBoolean(key, true)
        clip.description.extras = extras
        label = own
        replacedByOther = false
        expectingOwnChange = true
        manager.setPrimaryClip(clip)
        val delay = ttlMs.toLong().coerceIn(1_000L, 600_000L)
        deadlineElapsed = SystemClock.elapsedRealtime() + delay
        handler.postDelayed(timeout, delay)
        true
      } catch (_: Throwable) {
        false
      }
    }

    /** Removes the module's own copy now (sign-out, session end, wipe, hidden-data mode, lock). Idempotent. */
    Function("clearOwn") {
      removeOwnCopy()
    }

    /** Back in the foreground: if the time is up (the process was frozen), the copy goes now. */
    OnActivityEntersForeground {
      if (label != null && SystemClock.elapsedRealtime() >= deadlineElapsed) removeOwnCopy()
    }
  }
}
