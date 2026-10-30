package pl.eviacharge.keystore

import android.os.Build
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.SecretKeyFactory

/**
 * Keystore operations expo-secure-store does not offer (EVM-093 AC1, AC6; SR-CRYPTO-06, MASVS-CRYPTO-2).
 * expo-secure-store wraps every value of a keychain service with the AES-GCM key `AES/GCM/NoPadding:<service>:<suffix>`; deleting the
 * wrapped value alone leaves that key alive, so the wipe deletes the aliases of the database key's own service as well.
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
      } catch (_: Exception) {
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
