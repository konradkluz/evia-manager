package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import pl.eviacharge.upload.files.BootIds
import pl.eviacharge.upload.files.JobFileCodec
import pl.eviacharge.upload.http.HttpConfig
import pl.eviacharge.upload.notification.NotificationText
import pl.eviacharge.upload.session.AppAccess
import pl.eviacharge.upload.session.LoginInput
import pl.eviacharge.upload.session.LogoutAnswer
import pl.eviacharge.upload.session.MemoryVault
import pl.eviacharge.upload.session.RefreshAnswer
import pl.eviacharge.upload.session.SessionState
import pl.eviacharge.upload.session.TokenOwner

/** EVM-130 AC2, AC7: the pure parts the Android glue calls - the configuration of the build, the boot id, the access token for the app. */
class GluePortsTest {
    @Test
    fun `EVM-130 AC7 the configuration is read from the meta-data of the build - the API address, a list of storage hosts, the version`() {
        val config = HttpConfig.fromMetaData("https://api.example.test", "a.example.test, b.example.test:8443 ,", "1.2.3", false)
        assertEquals("https://api.example.test", config.apiOrigin)
        assertEquals(listOf("a.example.test", "b.example.test:8443"), config.storageHosts)
        assertEquals("1.2.3", config.clientVersion)
        assertFalse(config.e2eCleartext)
        assertEquals(
            HttpConfig.UNKNOWN_CLIENT_VERSION,
            HttpConfig.fromMetaData("https://api.example.test", "a.example.test", null, false).clientVersion,
        )
        assertEquals(
            HttpConfig.UNKNOWN_CLIENT_VERSION,
            HttpConfig.fromMetaData("https://api.example.test", "a.example.test", "1 2", false).clientVersion,
        )
    }

    @Test
    fun `EVM-130 AC7 the e2e variant allows http and the host of the scenario server, and nothing else does`() {
        val e2e = HttpConfig.fromMetaData("http://10.0.2.2:8787", "10.0.2.2:8787", "0.1.0", true)
        assertTrue(e2e.e2eCleartext)
        assertEquals("10.0.2.2:8787", e2e.apiAuthority)
        assertThrows(
            IllegalArgumentException::class.java,
        ) { HttpConfig.fromMetaData("http://10.0.2.2:8787", "10.0.2.2:8787", "0.1.0", false) }
    }

    @Test
    fun `EVM-130 AC7 a missing or bad value is an error without the value in its message (fail closed)`() {
        val bad =
            listOf(
                listOf(null, "a.example.test"),
                listOf("", "a.example.test"),
                listOf("https://api.example.test", null),
                listOf("https://api.example.test", " , "),
                listOf("https://api.example.test", "https://a.example.test"),
                listOf("https://api.example.test", "a b"),
            )
        for ((api, hosts) in bad) {
            val error = assertThrows(IllegalArgumentException::class.java) { HttpConfig.fromMetaData(api, hosts, "1.0.0", false) }
            assertFalse(error.message.orEmpty().contains("example"))
        }
    }

    @Test
    fun `EVM-101 AC2 the boot id has the form the JavaScript uses - the boot counter, else the boot time in minutes`() {
        assertEquals("boot-17", BootIds.of(17, 1_000_000L, 5L))
        assertEquals("boot-0", BootIds.of(0, 1_000_000L, 5L))
        assertEquals("boot-w17", BootIds.of(null, 1_000_000L, 5L))
        assertEquals("boot-w17", BootIds.of(-1, 1_000_000L, 5L))
        // Math.round of the JavaScript: .5 goes up
        assertEquals("boot-w3", BootIds.of(null, 150_000L, 0L))
        assertEquals("boot-w1", BootIds.of(null, 89_999L, 0L))
    }

    @Test
    fun `EVM-130 AC3 an identifier of a job file is the server shape only - a path, a colon or a blank is not`() {
        assertTrue(JobFileCodec.isIdentifier("0193a000-0000-7000-8000-00000000000a"))
        assertFalse(JobFileCodec.isIdentifier(""))
        assertFalse(JobFileCodec.isIdentifier("a:b"))
        assertFalse(JobFileCodec.isIdentifier("../x"))
        assertFalse(JobFileCodec.isIdentifier("x".repeat(65)))
    }

    @Test
    fun `EVM-130 AC3 what the app hands over at a sign-in is checked before it is stored - ids of the server shape, readable tokens`() {
        assertEquals("user-1:device-1", LoginInput.ownerOf("user-1", "device-1", "refresh", "access", 900_000L))
        val ok = Triple("user-1", "device-1", "refresh")

        fun owner(
            user: String = ok.first,
            device: String = ok.second,
            refresh: String = ok.third,
            access: String = "access",
            valid: Long = 1L,
        ) = LoginInput.ownerOf(user, device, refresh, access, valid)
        assertEquals("user-1:device-1", owner())
        assertNull(owner(user = ""))
        assertNull(owner(user = "a:b"))
        assertNull(owner(device = "../x"))
        assertNull(owner(refresh = ""))
        assertNull(owner(access = ""))
        assertNull(owner(refresh = "x".repeat(LoginInput.MAX_TOKEN_CHARS + 1)))
        assertEquals("user-1:device-1", owner(refresh = "x".repeat(LoginInput.MAX_TOKEN_CHARS)))
        assertNull(owner(access = "ab"))
        assertNull(owner(valid = 0L))
        assertNull(owner(valid = -5L))
        assertNull(owner(valid = LoginInput.MAX_ACCESS_VALID_MS + 1))
        assertEquals("user-1:device-1", owner(valid = LoginInput.MAX_ACCESS_VALID_MS))
    }

    @Test
    fun `EVM-130 AC6 the channel of the notification is called Wysyłanie plików`() {
        assertEquals("Wysyłanie plików", NotificationText.CHANNEL_NAME)
    }

    @Test
    fun `EVM-130 AC2 the app gets an access token and how long it holds, never a refresh token`() {
        var now = 1_000L
        val owner = TokenOwner(MemoryVault(), { RefreshAnswer.Success("access-1", 900_000L, "refresh-1") }, { now }, { LogoutAnswer.DONE })
        assertEquals(AppAccess.Blocked(SessionState.SIGNED_OUT), owner.accessForApp())
        owner.commitLogin("user-1:device-1", "refresh-0", "access-0", 900_000L)
        now += 100_000L
        assertEquals(AppAccess.Ready("access-0", "user-1:device-1", 800_000L), owner.accessForApp())
        // the server refused that token: one refresh replaces it, and a second caller with the same rejected token gets the new one
        assertEquals(AppAccess.Ready("access-1", "user-1:device-1", 900_000L), owner.accessForApp("access-0"))
        assertEquals(AppAccess.Ready("access-1", "user-1:device-1", 900_000L), owner.accessForApp("access-0"))
        now += 2_000_000L
        assertEquals(AppAccess.Ready("access-1", "user-1:device-1", 900_000L), owner.accessForApp())
    }

    @Test
    fun `EVM-130 AC2 a failed refresh is retry later for the app, and an expired token never has a negative validity`() {
        var answer: RefreshAnswer = RefreshAnswer.NotSent
        var now = 0L
        val owner = TokenOwner(MemoryVault(), { answer }, { now }, { LogoutAnswer.DONE })
        owner.commitLogin("user-1:device-1", "refresh-0", "access-0", 10_000L)
        now += 5_000L
        assertEquals(AppAccess.RetryLater, owner.accessForApp())
        answer = RefreshAnswer.Success("access-2", 900_000L, "refresh-2")
        assertEquals(AppAccess.Ready("access-2", "user-1:device-1", 900_000L), owner.accessForApp())
    }
}
