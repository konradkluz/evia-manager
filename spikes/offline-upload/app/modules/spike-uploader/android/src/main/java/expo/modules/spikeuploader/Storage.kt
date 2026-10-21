package expo.modules.spikeuploader

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// EVM-011 spike. All state lives in noBackupFilesDir (outside backups; also excluded by dataExtractionRules).
// Job files hold technical identifiers only: assetId, uploadId, part numbers, ETags, counters. No file names, no order data.

val UUID_REGEX = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

object Jobs {
  const val QUEUED = "queued"
  const val UPLOADING = "uploading"
  const val UPLOADED = "uploaded"
  const val PAUSED_REVOKED = "paused_revoked"
  const val FAILED = "failed"

  fun dir(ctx: Context): File = File(ctx.noBackupFilesDir, "evm011/jobs").also { it.mkdirs() }

  fun file(ctx: Context, assetId: String): File {
    require(UUID_REGEX.matches(assetId)) { "invalid asset id" }
    return File(dir(ctx), "$assetId.json")
  }

  @Synchronized
  fun read(ctx: Context, assetId: String): JSONObject? {
    val f = file(ctx, assetId)
    return if (f.exists()) JSONObject(f.readText()) else null
  }

  /** Atomic write: temp file + fsync + rename (a kill leaves either the old or the new complete file). */
  @Synchronized
  fun write(ctx: Context, job: JSONObject) {
    val f = file(ctx, job.getString("assetId"))
    val tmp = File(f.parentFile, f.name + ".tmp")
    FileOutputStream(tmp).use {
      it.write(job.toString().toByteArray())
      it.fd.sync()
    }
    if (!tmp.renameTo(f)) throw java.io.IOException("rename failed")
  }

  @Synchronized
  fun update(ctx: Context, assetId: String, block: (JSONObject) -> Unit) {
    val job = read(ctx, assetId) ?: return
    block(job)
    write(ctx, job)
  }

  fun all(ctx: Context): List<JSONObject> =
    (dir(ctx).listFiles { f -> f.name.endsWith(".json") } ?: emptyArray()).mapNotNull {
      try {
        JSONObject(it.readText())
      } catch (e: Exception) {
        null
      }
    }

  fun isFinal(state: String) = state == UPLOADED || state == PAUSED_REVOKED || state == FAILED

  fun jobIdFor(assetId: String): Int = (assetId.hashCode() and 0x7fffffff) % 900_000 + 1000
}

data class Config(val baseUrl: String, val deviceId: String, val token: String)

/** Token sealed with an AES-256-GCM key from the Android Keystore (no user-authentication requirement: ADR-0007 background work). */
object ConfigStore {
  private const val ALIAS = "evm011_spike_token_key"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  private fun dir(ctx: Context) = File(ctx.noBackupFilesDir, "evm011").also { it.mkdirs() }

  fun allowedBase(url: String) =
    url.startsWith("http://10.0.2.2:") || url.startsWith("http://127.0.0.1:") || url.startsWith("https://")

  fun save(ctx: Context, baseUrl: String, deviceId: String, token: String) {
    require(allowedBase(baseUrl)) { "base url not allowed" }
    require(deviceId.length in 1..64) { "device id" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.iv + cipher.doFinal(token.toByteArray())
    File(dir(ctx), "token.bin").writeBytes(sealed)
    File(dir(ctx), "config.json").writeText(JSONObject().put("baseUrl", baseUrl).put("deviceId", deviceId).toString())
  }

  fun read(ctx: Context): Config? {
    val tokenFile = File(dir(ctx), "token.bin")
    val cfgFile = File(dir(ctx), "config.json")
    if (!tokenFile.exists() || !cfgFile.exists()) return null
    val blob = tokenFile.readBytes()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
    val token = String(cipher.doFinal(blob.copyOfRange(12, blob.size)))
    val cfg = JSONObject(cfgFile.readText())
    return Config(cfg.getString("baseUrl"), cfg.getString("deviceId"), token)
  }

  fun hasConfig(ctx: Context) = File(dir(ctx), "token.bin").exists() && File(dir(ctx), "config.json").exists()
}
