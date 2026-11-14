package pl.eviacharge.upload.session

import pl.eviacharge.upload.Json
import pl.eviacharge.upload.JsonException
import pl.eviacharge.upload.files.AtomicFiles
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encryption or decryption failed or there is no key. No message and no cause: nothing of the record may reach a log. */
class CipherException : Exception("cipher failure") {
    override fun fillInStackTrace(): Throwable = this
}

/** The result of an encryption: the IV chosen by the cipher (the Keystore picks it itself) and the ciphertext with the tag. */
class SealedRecord(
    val iv: ByteArray,
    val cipherText: ByteArray,
)

/**
 * The port of the cipher of the token record. The Android glue implements it with a key from the Keystore ([JceRecordCipher] with a
 * supplier of that key: AES/GCM/NoPadding, 256 bits, no user authentication, a random IV from the Keystore).
 */
interface RecordCipher {
    @Throws(CipherException::class)
    fun encrypt(
        plain: ByteArray,
        aad: ByteArray,
    ): SealedRecord

    @Throws(CipherException::class)
    fun decrypt(
        iv: ByteArray,
        cipherText: ByteArray,
        aad: ByteArray,
    ): ByteArray
}

/**
 * AES/GCM/NoPadding over a [SecretKey] from [key]. The IV is never given: the provider generates a random one (the Keystore requires
 * that with `randomizedEncryptionRequired`), and the record carries it. A missing key or any failure of the provider is a [CipherException].
 */
class JceRecordCipher(
    private val key: () -> SecretKey?,
) : RecordCipher {
    override fun encrypt(
        plain: ByteArray,
        aad: ByteArray,
    ): SealedRecord =
        guarded {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key() ?: throw CipherException())
            cipher.updateAAD(aad)
            val cipherText = cipher.doFinal(plain)
            SealedRecord(cipher.iv, cipherText)
        }

    override fun decrypt(
        iv: ByteArray,
        cipherText: ByteArray,
        aad: ByteArray,
    ): ByteArray =
        guarded {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key() ?: throw CipherException(), GCMParameterSpec(TAG_BITS, iv))
            cipher.updateAAD(aad)
            cipher.doFinal(cipherText)
        }

    private fun <T> guarded(block: () -> T): T =
        try {
            block()
        } catch (error: GeneralSecurityException) {
            throw CipherException()
        } catch (error: RuntimeException) {
            // providers (the Keystore) report a lost key also with unchecked exceptions
            throw CipherException()
        }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}

private val MAGIC = byteArrayOf('E'.code.toByte(), 'V'.code.toByte(), 'T'.code.toByte(), 'K'.code.toByte())
private const val FORMAT_VERSION = 1
private const val HEADER_BYTES = 6
private const val MIN_IV_BYTES = 12
private const val MAX_IV_BYTES = 16
private const val TAG_BYTES = 16
private const val MAX_FILE_BYTES = 64 * 1024
private const val MAX_TOKEN_CHARS = 4096
private const val MAX_ENTRIES = 4

/** Additional authenticated data: the name and the version of the record, so a record cannot be passed off as another kind or version. */
private val AAD = "evia-token-record/$FORMAT_VERSION".toByteArray(Charsets.US_ASCII)

/**
 * The token store in a file (EVM-130 AC3, security 1): `EVTK` + version + IV length + IV + ciphertext of the record, written atomically
 * (temporary file, fsync, rename). A corrupt record, a failed decryption and a missing key all give [VaultRead.Unreadable] ("sign in
 * again"): no crash, no plain-text fallback, nothing logged. The key lives in the Keystore under its own alias, separate from the key of
 * the database (a sign-out removes the token, not the database).
 */
class FileTokenVault(
    private val file: File,
    private val cipher: RecordCipher,
) : TokenVault {
    override fun read(): VaultRead {
        if (!file.exists()) return VaultRead.Empty
        val bytes = AtomicFiles.read(file, MAX_FILE_BYTES) ?: return VaultRead.Unreadable
        return open(bytes)?.let { VaultRead.Found(it) } ?: VaultRead.Unreadable
    }

    @Throws(IOException::class)
    override fun write(record: TokenRecord) {
        val plain = Json.stringify(encode(record)).toByteArray(Charsets.UTF_8)
        val sealed =
            try {
                cipher.encrypt(plain, AAD)
            } catch (error: CipherException) {
                throw IOException("encryption failed")
            }
        val out = ByteArray(HEADER_BYTES + sealed.iv.size + sealed.cipherText.size)
        MAGIC.copyInto(out)
        out[MAGIC.size] = FORMAT_VERSION.toByte()
        out[MAGIC.size + 1] = sealed.iv.size.toByte()
        sealed.iv.copyInto(out, HEADER_BYTES)
        sealed.cipherText.copyInto(out, HEADER_BYTES + sealed.iv.size)
        AtomicFiles.write(file, out)
    }

    @Throws(IOException::class)
    override fun clear() = AtomicFiles.delete(file)

    private fun open(bytes: ByteArray): TokenRecord? {
        if (bytes.size < HEADER_BYTES || !bytes.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return null
        if (bytes[MAGIC.size].toInt() != FORMAT_VERSION) return null
        val ivLength = bytes[MAGIC.size + 1].toInt()
        if (ivLength !in MIN_IV_BYTES..MAX_IV_BYTES || bytes.size < HEADER_BYTES + ivLength + TAG_BYTES) return null
        val plain =
            try {
                cipher.decrypt(
                    bytes.copyOfRange(HEADER_BYTES, HEADER_BYTES + ivLength),
                    bytes.copyOfRange(HEADER_BYTES + ivLength, bytes.size),
                    AAD,
                )
            } catch (error: CipherException) {
                return null
            }
        return decode(plain)
    }

    private fun encode(record: TokenRecord): Map<String, Any?> =
        mapOf(
            "session" to record.session?.let { mapOf("ownerId" to it.ownerId, "refreshToken" to it.refreshToken) },
            "pending" to record.pendingRevocations,
        )

    private fun decode(plain: ByteArray): TokenRecord? {
        val fields =
            try {
                Json.parse(String(plain, Charsets.UTF_8)) as? Map<*, *>
            } catch (error: JsonException) {
                null
            } ?: return null
        if (fields.keys != setOf("session", "pending")) return null
        val session =
            when (val raw = fields["session"]) {
                null -> null
                is Map<*, *> -> decodeSession(raw) ?: return null
                else -> return null
            }
        val pending = (fields["pending"] as? List<*>)?.map { token(it) ?: return null } ?: return null
        return if (pending.size > MAX_ENTRIES) null else TokenRecord(session, pending)
    }

    private fun decodeSession(raw: Map<*, *>): StoredSession? {
        if (raw.keys != setOf("ownerId", "refreshToken")) return null
        return StoredSession(token(raw["ownerId"]) ?: return null, token(raw["refreshToken"]) ?: return null)
    }

    private fun token(value: Any?): String? = (value as? String)?.takeIf { it.isNotEmpty() && it.length <= MAX_TOKEN_CHARS }
}
