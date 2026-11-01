package pl.eviacharge.keystore

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
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

    /**
     * EVM-101 AC3: the system unlock window, `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` (API 28–29 cannot combine them: the deprecated
     * `setDeviceCredentialAllowed` is the way there). Resolves `success`, `cancelled` or `error`; never a message. No CryptoObject.
     */
    AsyncFunction("authenticate") { title: String, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        promise.resolve("error")
        return@AsyncFunction
      }
      activity.runOnUiThread {
        var settled = false
        fun settle(code: String) {
          if (!settled) {
            settled = true
            promise.resolve(code)
          }
        }
        try {
          val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = settle("success")
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = settle(
              when (errorCode) {
                BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "cancelled"
                else -> "error"
              },
            )
          }
          val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
              setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            } else {
              @Suppress("DEPRECATION")
              setDeviceCredentialAllowed(true)
            }
          }.build()
          BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(info)
        } catch (error: Exception) {
          settle("error")
        }
      }
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

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
    private const val UNAUTHENTICATED = "keystoreUnauthenticated"
    private const val UNKNOWN = "unknown"
  }
}
