package pl.eviacharge.upload.session

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.Json
import java.io.File
import java.io.IOException
import java.security.ProviderException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

private fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

private val RECORD = TokenRecord(StoredSession("user-1:device-1", "refresh-secret-1"), listOf("pending-secret-1", "pending-secret-2"))

/** EVM-130 AC3 (security 1): the format and the logic of the token store, on a programmatic AES-GCM key. */
class TokenVaultFileTest {
    @TempDir
    lateinit var directory: File

    private val key = newKey()
    private val cipher = JceRecordCipher { key }
    private val aad = "evia-token-record/1".toByteArray(Charsets.US_ASCII)

    private fun vault(
        c: RecordCipher = cipher,
        name: String = "token.bin",
    ) = FileTokenVault(File(directory, name), c)

    /** A file with the right format around [plain], for the tests of the content checks. */
    private fun fileWith(plain: String): File {
        val sealed = cipher.encrypt(plain.toByteArray(Charsets.UTF_8), aad)
        val file = File(directory, "crafted.bin")
        file.writeBytes(byteArrayOf(69, 86, 84, 75, 1, sealed.iv.size.toByte()) + sealed.iv + sealed.cipherText)
        return file
    }

    @Test
    fun `EVM-130 AC3 a record written is read back, and nothing is there before`() {
        val vault = vault()
        assertEquals(VaultRead.Empty, vault.read())
        vault.write(RECORD)
        assertEquals(VaultRead.Found(RECORD), vault.read())
        vault.write(TokenRecord(null, emptyList()))
        assertEquals(VaultRead.Found(TokenRecord(null, emptyList())), vault.read())
    }

    @Test
    fun `EVM-130 AC3 the file is encrypted - no token appears in it - and carries the version and a random IV`() {
        val vault = vault()
        vault.write(RECORD)
        val bytes = File(directory, "token.bin").readBytes()
        val text = String(bytes, Charsets.ISO_8859_1)
        assertFalse(text.contains("refresh-secret-1") || text.contains("pending-secret") || text.contains("user-1"))
        assertEquals("EVTK", text.substring(0, 4))
        assertEquals(1, bytes[4].toInt())
        assertEquals(12, bytes[5].toInt())
        vault.write(RECORD)
        assertNotEquals(bytes.toList(), File(directory, "token.bin").readBytes().toList())
    }

    @Test
    fun `EVM-130 AC3 a record cannot be passed off under another name or version - the AAD is bound`() {
        val sealed = cipher.encrypt("x".toByteArray(), aad)
        assertThrows(CipherException::class.java) { cipher.decrypt(sealed.iv, sealed.cipherText, "evia-token-record/2".toByteArray()) }
        assertArrayEquals("x".toByteArray(), cipher.decrypt(sealed.iv, sealed.cipherText, aad))
    }

    @Test
    fun `EVM-130 AC3 a corrupt record - flipped byte, truncation, wrong magic, version or IV length - is unreadable, never a crash`() {
        val vault = vault()
        vault.write(RECORD)
        val good = File(directory, "token.bin").readBytes()
        val variants =
            mapOf(
                "flipped" to good.copyOf().also { it[it.size - 3] = (it[it.size - 3] + 1).toByte() },
                "truncated" to good.copyOf(good.size - 5),
                "header only" to good.copyOf(4),
                "empty" to ByteArray(0),
                "magic" to good.copyOf().also { it[0] = 0 },
                "version" to good.copyOf().also { it[4] = 2 },
                "iv length" to good.copyOf().also { it[5] = 3 },
                "iv too long" to good.copyOf().also { it[5] = 100 },
                "short body" to good.copyOf(6 + 12 + 10),
            )
        for ((name, bytes) in variants) {
            File(directory, "token.bin").writeBytes(bytes)
            assertEquals(VaultRead.Unreadable, vault.read(), name)
        }
    }

    @Test
    fun `EVM-130 AC3 a lost or different key and a failing cipher give a sign-in, not a crash and not a plain-text fallback`() {
        vault().write(RECORD)
        assertEquals(VaultRead.Unreadable, vault(JceRecordCipher { newKey() }).read())
        assertEquals(VaultRead.Unreadable, vault(JceRecordCipher { null }).read())
        assertEquals(VaultRead.Unreadable, vault(JceRecordCipher { throw ProviderException("key permanently invalidated") }).read())
        // nothing was rewritten and no plain-text copy exists
        assertEquals(listOf("token.bin"), directory.list()!!.toList())
        assertFalse(String(File(directory, "token.bin").readBytes(), Charsets.ISO_8859_1).contains("refresh-secret-1"))
    }

    @Test
    fun `EVM-130 AC3 a record that cannot be encrypted is not written, the old one stays, and no temporary file is left`() {
        val vault = vault()
        vault.write(RECORD)
        assertThrows(IOException::class.java) { vault(JceRecordCipher { null }).write(TokenRecord(null, listOf("x"))) }
        assertEquals(VaultRead.Found(RECORD), vault.read())
        assertEquals(listOf("token.bin"), directory.list()!!.toList())
    }

    @Test
    fun `EVM-130 AC3 a write that fails keeps the old record and leaves no temporary file`() {
        val target = File(directory, "blocked")
        File(target, "inside").apply { parentFile.mkdirs() }.writeText("x")
        val failing = FileTokenVault(target, cipher)
        val error = assertThrows(IOException::class.java) { failing.write(RECORD) }
        assertFalse(error.message.orEmpty().contains(directory.name))
        assertFalse(File(directory, "blocked.tmp").exists())
        assertEquals(VaultRead.Unreadable, failing.read())
    }

    @Test
    fun `EVM-130 AC3 clear removes the file, and a missing file is nothing to do`() {
        val vault = vault()
        vault.clear()
        vault.write(RECORD)
        vault.clear()
        assertFalse(File(directory, "token.bin").exists())
        assertEquals(VaultRead.Empty, vault.read())
    }

    @Test
    fun `EVM-130 AC3 a record with a wrong content is unreadable - bad JSON, wrong shape, empty or oversized tokens, too many pending`() {
        val bad =
            listOf(
                "not json",
                "[]",
                """{"session":null}""",
                """{"session":null,"pending":[],"extra":1}""",
                """{"session":5,"pending":[]}""",
                """{"session":{"ownerId":"a"},"pending":[]}""",
                """{"session":{"ownerId":5,"refreshToken":"b"},"pending":[]}""",
                """{"session":{"ownerId":"a","refreshToken":5},"pending":[]}""",
                """{"session":{"ownerId":"a","refreshToken":""},"pending":[]}""",
                """{"session":{"ownerId":"a","refreshToken":"b","x":1},"pending":[]}""",
                """{"session":null,"pending":"x"}""",
                """{"session":null,"pending":[1]}""",
                """{"session":null,"pending":["a","b","c","d","e"]}""",
                """{"session":{"ownerId":"a","refreshToken":"${"x".repeat(5000)}"},"pending":[]}""",
            )
        for (plain in bad) {
            val file = fileWith(plain)
            assertEquals(VaultRead.Unreadable, FileTokenVault(file, cipher).read(), plain.take(40))
        }
        val good = fileWith("""{"session":{"ownerId":"a","refreshToken":"b"},"pending":["c"]}""")
        assertEquals(VaultRead.Found(TokenRecord(StoredSession("a", "b"), listOf("c"))), FileTokenVault(good, cipher).read())
    }

    @Test
    fun `EVM-130 AC3 an oversized file is unreadable, and the plain record has the documented shape`() {
        File(directory, "token.bin").writeBytes(ByteArray(70_000))
        assertEquals(VaultRead.Unreadable, vault().read())
        assertEquals(setOf("session", "pending"), Json.obj(Json.parse("""{"session":null,"pending":[]}""")).keys)
    }
}
