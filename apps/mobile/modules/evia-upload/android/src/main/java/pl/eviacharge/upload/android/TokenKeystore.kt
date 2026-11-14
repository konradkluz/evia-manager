package pl.eviacharge.upload.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import pl.eviacharge.upload.files.KeyEraser
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The Android Keystore key of the token store (EVM-130 AC3; SR-SESS-09, MASVS-CRYPTO-1/2): AES-256 for AES/GCM/NoPadding, no user
 * authentication (the job runs without the user), a random IV chosen by the Keystore (`randomizedEncryptionRequired`; the app never gives
 * an IV). Its OWN alias: it is not the key of the SQLCipher database and not an alias of expo-secure-store (those start with
 * `AES/GCM/NoPadding:`), so a sign-out removes this key and leaves the database and its key alone. Only the platform is called here:
 * the format of the record and every decision about a failure are in the pure engine (`FileTokenVault`, `JceRecordCipher`).
 */
class TokenKeystore : KeyEraser {
  /** The key, created on first use. Any failure of the Keystore is `null` (the engine then says "sign in again", never a crash). */
  @Synchronized
  fun key(): SecretKey? =
    try {
      val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
      (store.getKey(ALIAS, null) as? SecretKey) ?: generate()
    } catch (error: Exception) {
      null
    }

  /** Removes the key of the token store; the chain of the wipe calls it. A failure is reported without a message (no alias, no text). */
  @Synchronized
  override fun deleteTokenKey() {
    try {
      KeyStore.getInstance(PROVIDER).apply { load(null) }.deleteEntry(ALIAS)
    } catch (error: Exception) {
      throw IllegalStateException("key removal failed")
    }
  }

  private fun generate(): SecretKey {
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(KEY_BITS)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(false)
      .build()
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    generator.init(spec)
    return generator.generateKey()
  }

  private companion object {
    const val PROVIDER = "AndroidKeyStore"
    const val ALIAS = "evia.upload.token-key"
    const val KEY_BITS = 256
  }
}
