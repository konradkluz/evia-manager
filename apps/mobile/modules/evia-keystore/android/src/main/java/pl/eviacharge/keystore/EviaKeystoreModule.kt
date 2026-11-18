package pl.eviacharge.keystore

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.view.ViewTreeObserver
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.SecretKeyFactory

/**
 * Keystore operations expo-secure-store does not offer (EVM-093 AC1, AC6; SR-CRYPTO-06, MASVS-CRYPTO-2), and the description of the
 * phone for the sign-in (EVM-100).
 * expo-secure-store wraps every value of a keychain service with the AES-GCM key `AES/GCM/NoPadding:<service>:<suffix>`; deleting the
 * wrapped value alone leaves that key alive, so the wipe deletes the aliases of the database key's own service as well.
 * EVM-101 adds the device controls: the screen-lock fact, the boot clock for the app lock and the system unlock window. The unlock
 * is a UI gate only (policy P7): no `CryptoObject`, no key alias, no access to the keys of the app.
 * Nothing here logs, and no alias, service name or exception text is returned to JavaScript.
 */
class EviaKeystoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EviaKeystore")

    /** Deletes every alias of the service; idempotent (no alias = success). Resolves `true` once none is left. */
    AsyncFunction("deleteServiceAliases") { service: String ->
      val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
      val prefix = aliasPrefix(service)
      for (alias in keyStore.aliases().toList()) {
        if (alias == prefix || alias.startsWith("$prefix:")) keyStore.deleteEntry(alias)
      }
      keyStore.aliases().toList().none { it == prefix || it.startsWith("$prefix:") }
    }

    /**
     * Description of the phone for the sign-in (EVM-100 AC1; contract `MobileDeviceInfo`, MASVS-PRIVACY-1): model, Android version
     * and security patch level only — no IMEI, serial number, ANDROID_ID or advertising id. Normalised to the contract in JavaScript.
     */
    Function("deviceInfo") {
      mapOf(
        "model" to (Build.MODEL ?: ""),
        "osVersion" to (Build.VERSION.RELEASE ?: ""),
        "securityPatch" to (Build.VERSION.SECURITY_PATCH ?: ""),
      )
    }

    /**
     * EVM-101 AC1 (SR-MOB-06): the phone has a PIN, pattern, password or biometrics behind one (`KeyguardManager.isDeviceSecure`).
     * Any failure counts as "no lock" (fail-closed).
     */
    Function("isDeviceSecure") {
      try {
        val manager = appContext.reactContext?.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        manager?.isDeviceSecure == true
      } catch (error: Exception) {
        false
      }
    }

    /** EVM-101 AC3: time since boot INCLUDING deep sleep (CLOCK_BOOTTIME), for the 5-minute app lock; unlike `performance.now()`. */
    Function("elapsedRealtime") {
      SystemClock.elapsedRealtime().toDouble()
    }

    /** EVM-101 AC2: the boot counter (`Settings.Global.BOOT_COUNT`) tells one boot from another for the 7-day rule; -1 = unknown. */
    Function("bootCount") {
      try {
        val resolver = appContext.reactContext?.contentResolver
        if (resolver == null) -1 else Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT, -1)
      } catch (error: Exception) {
        -1
      }
    }

    /**
     * EVM-101 AC3: the system unlock window, `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` (API 28–29 cannot combine them: the deprecated
     * `setDeviceCredentialAllowed` is the way there). Resolves a code of a closed list, never a message of the system (SR-LOG-08):
     * `success`, `cancelled`, `superseded`, `error`, `not_resumed_timeout`, `no_callback_timeout`, `cannot_authenticate`, `exception`.
     * No CryptoObject. Every call is settled exactly once: a newer call replaces the older one (when the older window is on screen,
     * the newer one is shown after the library reported the cancel or after a short limit), the window is asked for only while the
     * activity is resumed and has the window focus, and a request that the system drops silently is cancelled after a few seconds.
     * Needs USE_BIOMETRIC in the merged manifest (API 28+; without it the system refuses the request without a window) and, on API
     * 24-27, USE_FINGERPRINT (declared by androidx.biometric 1.1.0 itself, which uses FingerprintManagerCompat there).
     */
    AsyncFunction("authenticate") { title: String, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        promise.resolve("error")
        return@AsyncFunction
      }
      activity.runOnUiThread { startAttempt(activity, title, promise) }
    }

    /** `strongbox` | `secure_hardware` | `software` | `unknown` — a diagnostic fact that never blocks (the emulator has no TEE). */
    AsyncFunction("securityLevel") { service: String ->
      try {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        val entry = keyStore.getEntry("${aliasPrefix(service)}:$UNAUTHENTICATED", null) as? KeyStore.SecretKeyEntry
          ?: return@AsyncFunction UNKNOWN
        val factory = SecretKeyFactory.getInstance(entry.secretKey.algorithm, PROVIDER)
        val info = factory.getKeySpec(entry.secretKey, KeyInfo::class.java) as KeyInfo
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "secure_hardware"
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
            else -> UNKNOWN
          }
        } else {
          @Suppress("DEPRECATION")
          if (info.isInsideSecureHardware) "secure_hardware" else "software"
        }
      } catch (error: Exception) {
        UNKNOWN
      }
    }
  }

  private fun aliasPrefix(service: String) = "AES/GCM/NoPadding:$service"

  /** The attempt in flight (main thread only); a newer call replaces it. */
  private var current: Attempt? = null

  /**
   * An aborted attempt whose window the library is still closing (main thread only). All instances of `BiometricPrompt` of one
   * activity share a ViewModel and a fragment, so a late `ERROR_CANCELED` of the old window could settle a newer attempt: the newer
   * one begins only after that callback or after `WINDOW_CLOSE_MS`.
   */
  private var closing: Attempt? = null

  private fun startAttempt(activity: FragmentActivity, title: String, promise: Promise) {
    var attempt: Attempt? = null
    try {
      // an older attempt without a window is only settled (nothing to cancel in the library); with a window it is cancelled
      current?.abort("superseded")
      val authenticators = pickAuthenticators(activity)
      if (authenticators == null) {
        promise.resolve("cannot_authenticate")
        return
      }
      val created = Attempt(activity, title, authenticators, promise)
      attempt = created
      current = created
      val begin = { beginSafely(created) }
      val waitFor = closing
      if (waitFor == null) begin() else waitFor.afterGone(begin)
    } catch (error: Throwable) {
      // Throwable on purpose: a class missing after shrinking (NoClassDefFoundError) must not leave the promise open
      if (attempt != null) attempt.abort("exception") else promise.resolve("exception")
    }
  }

  private fun beginSafely(attempt: Attempt) {
    try {
      attempt.begin()
    } catch (error: Throwable) {
      attempt.abort("exception")
    }
  }

  /**
   * The authenticators the phone can use now, or `null` (= `cannot_authenticate`). API 30+: strong biometrics or the screen lock; when
   * the combination is refused but the phone has a screen lock, the screen lock alone. API 28-29: the legacy marker, valid when the
   * phone has a screen lock (the combination is not supported there).
   */
  private fun pickAuthenticators(activity: FragmentActivity): Int? {
    val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    val secure = keyguard?.isDeviceSecure == true
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return if (secure) LEGACY_CREDENTIAL else null
    val manager = BiometricManager.from(activity)
    val both = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    if (manager.canAuthenticate(both) == BiometricManager.BIOMETRIC_SUCCESS) return both
    val credential = BiometricManager.Authenticators.DEVICE_CREDENTIAL
    if (secure && manager.canAuthenticate(credential) == BiometricManager.BIOMETRIC_SUCCESS) return credential
    return null
  }

  /**
   * One request of the unlock window; every method runs on the main thread. `settle` resolves the promise at most once and removes
   * every observer and timer; `abort` also cancels the window and ignores the callback that the cancel causes.
   */
  private inner class Attempt(
    private val activity: FragmentActivity,
    private val title: String,
    private val authenticators: Int,
    private val promise: Promise,
  ) {
    private val handler = Handler(Looper.getMainLooper())
    private var settled = false
    private var shown = false
    private var focusLostAfterShow = false
    private var prompt: BiometricPrompt? = null
    private val afterGoneActions = ArrayList<() -> Unit>()
    private val gone = Runnable { fireGone() }

    private val lifecycleObserver = object : LifecycleEventObserver {
      override fun onStateChanged(source: LifecycleOwner, event: Lifecycle.Event) {
        // a destroyed activity must not stay in `current`; the window dies with it
        if (event == Lifecycle.Event.ON_DESTROY) settle("error") else showWhenReady()
      }
    }
    private val focusListener = object : ViewTreeObserver.OnWindowFocusChangeListener {
      override fun onWindowFocusChanged(hasFocus: Boolean) {
        if (!shown) {
          showWhenReady()
        } else if (!hasFocus) {
          focusLostAfterShow = true // the system window is on screen: the user may take their time
        }
      }
    }
    // guarded: this timer is armed BEFORE the observer is added (the observer may show the window synchronously)
    private val notResumed = Runnable { if (!shown) settle("not_resumed_timeout") }
    private val noCallback = Runnable {
      // the window never took the focus and nothing came back: the system dropped the request silently. Once the window took the
      // focus (`focusLostAfterShow`) the user may take their time and this guard never fires
      if (!settled && !focusLostAfterShow && activity.hasWindowFocus()) abort("no_callback_timeout")
    }

    private fun ready() = activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && activity.hasWindowFocus()

    fun begin() {
      if (settled) return // replaced while the older window was closing
      if (activity.lifecycle.currentState == Lifecycle.State.DESTROYED) {
        settle("error")
        return
      }
      // order matters: `addObserver` replays the events of a resumed activity synchronously and may show the window right here
      handler.postDelayed(notResumed, WAIT_FOR_ACTIVITY_MS)
      activity.window.decorView.viewTreeObserver.addOnWindowFocusChangeListener(focusListener)
      activity.lifecycle.addObserver(lifecycleObserver)
      showWhenReady()
    }

    /** Runs `action` when the library has closed this (aborted) window, or after the short limit. */
    fun afterGone(action: () -> Unit) {
      afterGoneActions.add(action)
    }

    private fun fireGone() {
      handler.removeCallbacks(gone)
      if (closing === this) closing = null
      val actions = ArrayList(afterGoneActions)
      afterGoneActions.clear()
      for (action in actions) action()
    }

    private fun showWhenReady() {
      if (settled || shown || !ready()) return
      try {
        show()
      } catch (error: Throwable) {
        abort("exception")
      }
    }

    private fun show() {
      shown = true
      handler.removeCallbacks(notResumed)
      // the lifecycle observer stays: ON_DESTROY still has to settle the attempt
      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          settle("success")
          fireGone()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          settle(
            when (errorCode) {
              BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "cancelled"
              else -> "error"
            },
          )
          fireGone() // for an aborted attempt: the library has closed its window, the next attempt may begin
        }
      }
      val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).apply {
        if (authenticators == LEGACY_CREDENTIAL) {
          @Suppress("DEPRECATION")
          setDeviceCredentialAllowed(true)
        } else {
          setAllowedAuthenticators(authenticators)
        }
      }.build()
      val created = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
      prompt = created
      created.authenticate(info)
      if (!settled) handler.postDelayed(noCallback, NO_CALLBACK_MS)
    }

    fun settle(code: String) {
      if (settled) return
      settled = true
      handler.removeCallbacks(notResumed)
      handler.removeCallbacks(noCallback)
      try {
        activity.lifecycle.removeObserver(lifecycleObserver)
        activity.window.decorView.viewTreeObserver.removeOnWindowFocusChangeListener(focusListener)
      } catch (error: Throwable) {
        // nothing left to detach
      }
      if (current === this) current = null
      promise.resolve(code)
    }

    fun abort(code: String) {
      val open = if (settled) null else prompt
      settle(code)
      if (open == null) return // no window was asked for: nothing to cancel in the library
      closing = this
      handler.postDelayed(gone, WINDOW_CLOSE_MS)
      try {
        open.cancelAuthentication() // asynchronous: the callback (ignored, settled) or the limit releases the next attempt
      } catch (error: Throwable) {
        fireGone()
      }
    }
  }

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
    private const val UNAUTHENTICATED = "keystoreUnauthenticated"
    private const val UNKNOWN = "unknown"

    /** Marker for API 28-29: the deprecated `setDeviceCredentialAllowed` instead of the combined authenticators. */
    private const val LEGACY_CREDENTIAL = -1

    /** How long to wait for a resumed, focused activity (the app is still starting) before the request fails. */
    private const val WAIT_FOR_ACTIVITY_MS = 3000L

    /** How long a shown request may stay without a callback while the activity keeps the window focus (= the system dropped it). */
    private const val NO_CALLBACK_MS = 3000L

    /** How long a newer attempt waits for the library to report the cancel of the older window. */
    private const val WINDOW_CLOSE_MS = 500L
  }
}
