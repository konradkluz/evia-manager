package pl.eviacharge.upload.files

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.Json
import java.io.File
import java.io.IOException

private fun assetNo(n: Int) = "0193a000-0000-7000-8000-%012d".format(n)

/** EVM-130 AC1: the durable mapping of asset → id of the system job. */
class JobIdsTest {
    @TempDir
    lateinit var root: File

    private fun registry(
        range: Int = 5,
        name: String = "ids.json",
    ) = JobIdRegistry(File(root, name), base = 1000, range = range)

    @Test
    fun `EVM-130 AC1 the same asset gets the same id after every restart, a new asset gets the next one from a counter`() {
        val first = registry()
        val a = first.idFor(assetNo(1))
        val b = first.idFor(assetNo(2))
        assertEquals(1000, a)
        assertEquals(1001, b)
        assertEquals(a, first.idFor(assetNo(1)))
        val restarted = registry()
        assertEquals(a, restarted.idFor(assetNo(1)))
        assertEquals(b, restarted.idFor(assetNo(2)))
        assertEquals(1002, restarted.idFor(assetNo(3)))
        assertEquals(listOf(1000, 1001, 1002), restarted.allIds())
        assertTrue(restarted.contains(1001))
        assertFalse(restarted.contains(5))
    }

    @Test
    fun `EVM-130 AC1 ids stay in the reserved range and never collide - a counter, not a hash`() {
        val registry = registry(range = 5)
        val ids = (1..5).map { registry.idFor(assetNo(it)) }
        assertEquals(ids.size, ids.toSet().size)
        assertTrue(ids.all { it in 1000 until 1005 })
        assertThrows(JobIdRangeExhaustedException::class.java) { registry.idFor(assetNo(6)) }
        registry.release(assetNo(3))
        assertEquals(1002, registry.idFor(assetNo(6)))
        registry.release(assetNo(99))
        assertEquals(assetNo(6).let { registry.idFor(it) }, 1002)
    }

    @Test
    fun `EVM-130 AC1 the counter goes on in the circle past ids that are still in use`() {
        val registry = registry(range = 3)
        registry.idFor(assetNo(1))
        registry.idFor(assetNo(2))
        registry.release(assetNo(1))
        assertEquals(1002, registry.idFor(assetNo(3)))
        assertEquals(1000, registry.idFor(assetNo(4)))
    }

    @Test
    fun `EVM-130 AC1 an id is not handed out when the mapping cannot be stored, and a release that cannot be stored is undone`() {
        val registry = JobIdRegistry(File(root, "blocked").also { File(it, "x").apply { parentFile.mkdirs() }.writeText("1") }, 1000, 5)
        assertThrows(IOException::class.java) { registry.idFor(assetNo(1)) }
        assertEquals(emptyList<Int>(), registry.allIds())
        val file = File(root, "ids.json")
        val working = JobIdRegistry(file, 1000, 5)
        working.idFor(assetNo(1))
        file.delete()
        file.mkdirs()
        File(file, "x").writeText("1")
        assertThrows(IOException::class.java) { working.release(assetNo(1)) }
        assertEquals(listOf(1000), working.allIds())
    }

    @Test
    fun `EVM-130 AC1 an unreadable or foreign mapping starts empty instead of crashing`() {
        val bad =
            listOf(
                "not json",
                "[]",
                """{"next":0}""",
                """{"ids":{}}""",
                """{"next":"x","ids":{}}""",
                """{"next":-1,"ids":{}}""",
                """{"next":99,"ids":{}}""",
                """{"next":0,"ids":[]}""",
                """{"next":0,"ids":{"asset-1":1000}}""",
                """{"next":0,"ids":{"${assetNo(1)}":5}}""",
                """{"next":0,"ids":{"${assetNo(1)}":"x"}}""",
            )
        for (text in bad) {
            File(root, "ids.json").writeText(text)
            val registry = registry()
            assertEquals(emptyList<Int>(), registry.allIds(), text)
            assertEquals(1000, registry.idFor(assetNo(1)), text)
        }
    }

    @Test
    fun `EVM-130 AC5 forgetting empties the memory and the file`() {
        val registry = registry()
        registry.idFor(assetNo(1))
        registry.forget()
        assertFalse(File(root, "ids.json").exists())
        assertEquals(emptyList<Int>(), registry.allIds())
        assertEquals(1000, registry.idFor(assetNo(2)))
        val text = File(root, "ids.json").readText()
        assertEquals(setOf("next", "ids"), Json.obj(Json.parse(text)).keys)
    }
}

/** EVM-130 AC5: the wipe marker and the chain of the cleaning. */
class WipeTest {
    @TempDir
    lateinit var root: File

    private val calls = mutableListOf<String>()
    private val files get() = UploadFiles(root)
    private val marker get() = WipeMarker(files.wipeMarkerFile)
    private var failStep: String? = null

    private fun chain(ids: JobIdRegistry = JobIdRegistry(files.jobIdsFile, 1000, 5)): WipeChain {
        fun step(name: String): () -> Unit =
            {
                calls.add(name)
                if (failStep == name) throw IOException("fails")
            }
        return WipeChain(
            files,
            marker,
            { step("cancel")() },
            { step("stop")() },
            { step("tokens")() },
            { step("key")() },
            ids,
        )
    }

    private fun populate() {
        val store = JobFileStore(files)
        store.arm(jobOf(ASSET_A))
        files.originalFile(ASSET_A).apply { parentFile.mkdirs() }.writeText("secret bytes")
        File(files.root, "tmp/leftover.tmp").apply { parentFile.mkdirs() }.writeText("half")
        files.tokenFile.writeText("token record")
        files.contactFile.writeText("{}")
        JobIdRegistry(files.jobIdsFile, 1000, 5).idFor(ASSET_A)
    }

    @Test
    fun `EVM-130 AC5 the marker is durable, stops everything while set, and is cleared only after the cleaning finished`() {
        val marker = marker
        assertFalse(marker.isStopped())
        assertEquals(WipeMarker.State.NONE, marker.state())
        marker.begin()
        assertTrue(marker.isStopped())
        assertEquals(WipeMarker.State.CLEANING, marker.state())
        assertFalse(marker.clearAfterLogin())
        assertTrue(marker.isStopped())
        marker.markCleaned()
        assertEquals(WipeMarker.State.CLEANED, marker.state())
        assertTrue(marker.clearAfterLogin())
        assertFalse(marker.isStopped())
        assertEquals(WipeMarker.State.NONE, marker.state())
        assertTrue(marker.clearAfterLogin())
    }

    @Test
    fun `EVM-130 AC5 an unreadable marker counts as cleaning - fail closed`() {
        files.wipeMarkerFile.writeBytes(ByteArray(200))
        assertEquals(WipeMarker.State.CLEANING, marker.state())
        assertTrue(marker.isStopped())
        files.wipeMarkerFile.writeText("garbage")
        assertEquals(WipeMarker.State.CLEANING, marker.state())
    }

    @Test
    fun `EVM-130 AC5 the chain runs in the order marker, cancel, stop, files, tokens, key - and the marker says cleaned`() {
        populate()
        val markerSeen = mutableListOf<Boolean>()
        val spying =
            WipeChain(
                files,
                marker,
                { markerSeen.add(marker.state() == WipeMarker.State.CLEANING).also { calls.add("cancel") } },
                {
                    calls.add("stop")
                    markerSeen.add(files.jobFile(ASSET_A).exists())
                },
                {
                    calls.add("tokens")
                    markerSeen.add(files.jobFile(ASSET_A).exists() || files.originalFile(ASSET_A).exists())
                },
                { calls.add("key") },
                JobIdRegistry(files.jobIdsFile, 1000, 5),
            )
        assertTrue(spying.run())
        assertEquals(listOf("cancel", "stop", "tokens", "key"), calls)
        // the marker was set before the first step, the job file still existed when the instances were stopped, and all files were gone before the tokens
        assertEquals(listOf(true, true, false), markerSeen)
        assertEquals(WipeMarker.State.CLEANED, marker.state())
        assertTrue(
            listOf(
                files.jobsDirectory,
                files.originalsDirectory,
                files.tokenFile,
                files.contactFile,
                files.jobIdsFile,
            ).none { it.exists() },
        )
        assertTrue(AtomicFiles.temporaryFiles(root).isEmpty())
    }

    @Test
    fun `EVM-130 AC5 a failing step does not stop the others, the marker stays cleaning, and the next run finishes the job`() {
        populate()
        failStep = "key"
        val chain = chain()
        assertFalse(chain.run())
        assertEquals(listOf("cancel", "stop", "tokens", "key"), calls)
        assertEquals(WipeMarker.State.CLEANING, marker.state())
        assertFalse(files.jobFile(ASSET_A).exists())
        failStep = null
        calls.clear()
        assertTrue(chain.finishIfPending())
        assertEquals(listOf("cancel", "stop", "tokens", "key"), calls)
        assertEquals(WipeMarker.State.CLEANED, marker.state())
    }

    @Test
    fun `EVM-130 AC5 every kind of failure of a step is survived - checked, state and unchecked`() {
        for (error in listOf<Throwable>(IOException("x"), IllegalStateException("x"), SecurityException("x"))) {
            val failing =
                WipeChain(files, marker, { throw error }, { }, { }, { }, JobIdRegistry(files.jobIdsFile, 1000, 5))
            assertFalse(failing.run(), error.toString())
        }
    }

    @Test
    fun `EVM-130 AC5 a cleaning interrupted by a kill is finished at the next start, and a finished one is not repeated`() {
        populate()
        marker.begin()
        val chain = chain()
        assertTrue(chain.finishIfPending())
        assertFalse(files.jobFile(ASSET_A).exists())
        calls.clear()
        assertTrue(chain.finishIfPending())
        assertTrue(calls.isEmpty())
        marker.clearAfterLogin()
        assertFalse(chain.finishIfPending())
    }

    @Test
    fun `EVM-130 AC5 running the chain twice is harmless - it is idempotent`() {
        populate()
        val chain = chain()
        assertTrue(chain.run())
        assertTrue(chain.run())
        assertEquals(WipeMarker.State.CLEANED, marker.state())
        assertNull(JobFileStore(files).read(ASSET_A))
    }

    @Test
    fun `EVM-130 AC5 when the marker cannot be written nothing is claimed and nothing starts`() {
        val blocker = File(root, "blocker").also { it.writeText("a file, not a directory") }
        val broken =
            WipeChain(
                files,
                WipeMarker(File(blocker, "wipe.marker")),
                { calls.add("cancel") },
                { },
                { },
                { },
                JobIdRegistry(files.jobIdsFile),
            )
        assertThrows(IOException::class.java) { broken.run() }
        assertTrue(calls.isEmpty())
    }
}

private class FixedReadings(
    var reading: ClockReading,
) : ClockReadings {
    override fun read() = reading
}

/** EVM-130 AC2 (security 3): the durable mark of the last authenticated contact. */
class ContactMarkerTest {
    @TempDir
    lateinit var root: File

    private val readings = FixedReadings(ClockReading(1_000_000L, 5_000L, "boot-1"))

    private fun marker() = ContactMarker(File(root, "contact.json"), readings)

    @Test
    fun `EVM-130 AC2 a contact writes the mark that survives a restart, with the server time`() {
        val marker = marker()
        assertNull(marker.read())
        marker.contact(1_234L)
        assertEquals(ContactMark(1_000_000L, 5_000L, "boot-1", 1_234L), marker.read())
        assertEquals(ContactMark(1_000_000L, 5_000L, "boot-1", 1_234L), marker().read())
        ContactSink.NONE.contact(null)
    }

    @Test
    fun `EVM-130 AC2 writes are throttled within one boot, but a later contact, a new boot or a clock going back are written`() {
        val marker = marker()
        marker.contact(null)
        readings.reading = ClockReading(1_030_000L, 35_000L, "boot-1")
        marker.contact(null)
        assertEquals(5_000L, marker.read()?.monoMs)
        readings.reading = ClockReading(1_070_000L, 5_000L + ContactMarker.THROTTLE_MS, "boot-1")
        marker.contact(9L)
        assertEquals(5_000L + ContactMarker.THROTTLE_MS, marker.read()?.monoMs)
        readings.reading = ClockReading(1_071_000L, 100L, "boot-1")
        marker.contact(null)
        assertEquals(100L, marker.read()?.monoMs)
        readings.reading = ClockReading(1_072_000L, 101L, "boot-2")
        marker.contact(null)
        assertEquals("boot-2", marker.read()?.bootId)
        assertNull(marker.read()?.serverTimeMs)
    }

    @Test
    fun `EVM-130 AC2 a failing write never fails the work and keeps the previous mark`() {
        val marker = ContactMarker(File(root, "blocked").also { File(it, "x").apply { parentFile.mkdirs() }.writeText("1") }, readings)
        marker.contact(1L)
        assertNull(marker.read())
    }

    @Test
    fun `EVM-130 AC2 a corrupt mark reads as none`() {
        val file = File(root, "contact.json")
        for (text in listOf(
            "not json",
            "[]",
            """{"v":2}""",
            """{"v":1,"wallMs":1,"monoMs":"x","bootId":"b"}""",
            """{"v":1,"wallMs":1,"monoMs":2,"bootId":""}""",
            """{"v":1,"wallMs":"1","monoMs":2,"bootId":"b"}""",
        )) {
            file.writeText(text)
            assertNull(ContactMarker(file, readings).read(), text)
        }
        file.writeText("""{"v":1,"wallMs":1,"monoMs":2,"bootId":"${"b".repeat(129)}"}""")
        assertNull(ContactMarker(file, readings).read())
        file.writeText("""{"v":1,"wallMs":1,"monoMs":2,"bootId":"b","serverTimeMs":null}""")
        assertEquals(ContactMark(1, 2, "b", null), ContactMarker(file, readings).read())
    }
}

/** EVM-130 AC4: SHA-256 as a stream and the rule for the local original. */
class OriginalTest {
    @TempDir
    lateinit var root: File

    @Test
    fun `EVM-130 AC4 the SHA-256 of a file is computed as a stream, larger than the buffer, and matches the known value`() {
        val file = File(root, "f.bin")
        file.writeBytes("abc".toByteArray())
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", FileDigest.sha256Hex(file))
        val big = File(root, "big.bin")
        big.writeBytes(ByteArray(200_000) { (it % 251).toByte() })
        val expected =
            java.security.MessageDigest
                .getInstance("SHA-256")
                .digest(big.readBytes())
                .joinToString("") { "%02x".format(it) }
        assertEquals(expected, FileDigest.sha256Hex(big))
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            FileDigest.sha256Hex(
                File(root, "e").also {
                    it.writeBytes(ByteArray(0))
                },
            ),
        )
    }

    @Test
    fun `EVM-130 AC4 the original stays until the server says clean - the verdict per state`() {
        assertEquals(OriginalVerdict.DELETE, OriginalPolicy.verdict("clean"))
        assertEquals(OriginalVerdict.DELETE, OriginalPolicy.verdict("processing"))
        assertEquals(OriginalVerdict.DELETE, OriginalPolicy.verdict("ready"))
        assertEquals(OriginalVerdict.KEEP, OriginalPolicy.verdict("uploaded"))
        assertEquals(OriginalVerdict.KEEP, OriginalPolicy.verdict("scanning"))
        assertEquals(OriginalVerdict.KEEP, OriginalPolicy.verdict("pending_upload"))
        assertEquals(OriginalVerdict.KEEP, OriginalPolicy.verdict("teleported"))
        assertEquals(OriginalVerdict.KEEP, OriginalPolicy.verdict("failed"))
        assertEquals(OriginalVerdict.KEEP_AND_RETRY, OriginalPolicy.verdict("failed", "checksum_mismatch"))
        assertEquals(OriginalVerdict.KEEP_QUARANTINED, OriginalPolicy.verdict("quarantined"))
    }
}
