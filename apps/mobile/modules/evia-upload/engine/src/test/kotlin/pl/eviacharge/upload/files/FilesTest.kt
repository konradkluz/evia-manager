package pl.eviacharge.upload.files

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import pl.eviacharge.upload.JobSnapshot
import pl.eviacharge.upload.JobState
import pl.eviacharge.upload.Json
import java.io.File
import java.io.IOException

internal const val ASSET_A = "0193a000-0000-7000-8000-00000000000a"
internal const val ASSET_B = "0193a000-0000-7000-8000-00000000000b"

internal fun snapshotOf(
    assetId: String = ASSET_A,
    state: JobState = JobState.ACTIVE,
) = JobSnapshot(
    schemaVersion = 1,
    assetId = assetId,
    size = 40L,
    uploadSessionId = "0193a000-0000-7000-8000-0000000000c1",
    idempotencyKey = "0193a000-0000-7000-8000-0000000000c2",
    partSize = 16L,
    partCount = 3,
    completeSent = false,
    state = state,
    etags = mapOf("1" to "\"etag-1\""),
)

internal fun jobOf(
    assetId: String = ASSET_A,
    snapshot: JobSnapshot? = null,
) = JobFileData(assetId, "0193a000-0000-7000-8000-0000000000d1", 40L, "user-1", "device-1", snapshot)

/** EVM-130 AC1, AC3, AC4: the atomic file, the layout of the base directory, the job file and its store. */
class FilesTest {
    @TempDir
    lateinit var root: File

    // ---- AtomicFiles

    @Test
    fun `EVM-130 AC1 a target without a parent directory (a file system root) is an IOException, not a NullPointerException`() {
        val top = root.toPath().root.toFile()
        assertThrows(IOException::class.java) { AtomicFiles.write(top, byteArrayOf(1)) }
    }

    @Test
    fun `EVM-130 AC3 an atomic write creates the directories, replaces the content and leaves no temporary file`() {
        val target = File(root, "a/b/file.bin")
        AtomicFiles.write(target, byteArrayOf(1, 2, 3))
        AtomicFiles.write(target, byteArrayOf(4, 5))
        assertArrayEquals(byteArrayOf(4, 5), AtomicFiles.read(target, 10))
        assertEquals(listOf("file.bin"), target.parentFile.list()!!.toList())
        assertTrue(AtomicFiles.temporaryFiles(root).isEmpty())
    }

    @Test
    fun `EVM-130 AC3 a failed atomic write throws without a path, removes its temporary file and keeps the target`() {
        val target = File(root, "dir")
        File(target, "x").apply { parentFile.mkdirs() }.writeText("1")
        val error = assertThrows(IOException::class.java) { AtomicFiles.write(target, byteArrayOf(1)) }
        assertFalse(error.message.orEmpty().contains(root.name))
        assertFalse(File(root, "dir.tmp").exists())
        assertTrue(File(target, "x").exists())
    }

    @Test
    fun `EVM-130 AC3 reading gives null for a missing file, a directory and a file longer than the limit`() {
        File(root, "d").mkdirs()
        File(root, "big").writeBytes(ByteArray(11))
        assertNull(AtomicFiles.read(File(root, "none"), 10))
        assertNull(AtomicFiles.read(File(root, "d"), 10))
        assertNull(AtomicFiles.read(File(root, "big"), 10))
        assertNotNull(AtomicFiles.read(File(root, "big"), 11))
    }

    @Test
    fun `EVM-130 AC5 delete is idempotent, fails without a path, and trees and leftovers of writes can be removed`() {
        AtomicFiles.delete(File(root, "none"))
        val full = File(root, "full").apply { mkdirs() }
        File(full, "x").writeText("1")
        val error = assertThrows(IOException::class.java) { AtomicFiles.delete(full) }
        assertFalse(error.message.orEmpty().contains(root.name))
        File(root, "n/leftover.tmp").apply { parentFile.mkdirs() }.writeText("t")
        assertEquals(1, AtomicFiles.temporaryFiles(root).size)
        assertTrue(AtomicFiles.deleteTree(File(root, "n")))
        assertTrue(AtomicFiles.deleteTree(File(root, "n")))
        assertTrue(AtomicFiles.temporaryFiles(root).isEmpty())
    }

    // ---- UploadFiles: paths from checked ids only (CWE-22)

    @Test
    fun `EVM-130 AC3 the path of an original and of a job is built from a checked UUID below the base directory`() {
        val files = UploadFiles(root)
        assertEquals(File(File(root, "originals"), ASSET_A), files.originalFile(ASSET_A))
        assertEquals(File(File(root, "jobs"), "$ASSET_A.json"), files.jobFile(ASSET_A))
        assertTrue(UploadFiles.isAssetId(ASSET_A))
    }

    @Test
    fun `EVM-130 AC3 a name that is not a lower-case UUID never becomes a path - traversal, separators, upper case, empty`() {
        val files = UploadFiles(root)
        val bad =
            listOf("", "../etc/passwd", "..", "a/b", "a\\b", ASSET_A.uppercase(), "$ASSET_A/..", "$ASSET_A.json", " $ASSET_A", "asset-1")
        for (name in bad) {
            assertThrows(InvalidIdentifierException::class.java, { files.originalFile(name) }, name)
            assertThrows(InvalidIdentifierException::class.java, { files.jobFile(name) }, name)
        }
        assertFalse(InvalidIdentifierException().message.orEmpty().contains("etc"))
    }

    @Test
    fun `EVM-130 AC3 a directory that resolves outside the base is refused even for a valid UUID`() {
        val outside = File(root, "elsewhere")
        val files = UploadFiles(File(root, "base")) { if (it.name == ASSET_A) File(outside, it.name) else it }
        assertThrows(InvalidIdentifierException::class.java) { files.originalFile(ASSET_A) }
        assertEquals(File(File(root, "base"), "originals").path, files.originalsDirectory.path)
    }

    // ---- job file: schema and store

    @Test
    fun `EVM-130 AC3 the job file has only allowlisted keys and no token, address, path, name or description`() {
        val files = UploadFiles(root)
        val store = JobFileStore(files)
        store.arm(jobOf())
        store.save(snapshotOf())
        val text = files.jobFile(ASSET_A).readText()
        val top = Json.obj(Json.parse(text))
        assertEquals(JobFileCodec.FIELD_NAMES, top.keys)
        assertEquals(JobSnapshot.FIELD_NAMES, Json.obj(top["snapshot"]).keys)
        assertFalse(
            Regex("(?i)https?:|bearer|x-amz|signature|token|secret|password|\\.jpg|\\.mp4|[a-z]:\\\\|/storage/").containsMatchIn(text),
            text,
        )
        // no value looks like a path or an address: only identifiers, sizes, counters, ETags
        val strings = mutableListOf<String>()

        fun collect(value: Any?) {
            when (value) {
                is String -> strings.add(value)
                is Map<*, *> -> value.values.forEach { collect(it) }
                else -> Unit
            }
        }
        collect(top)
        assertTrue(strings.none { it.contains("://") || it.contains('\\') || it.startsWith("/") })
    }

    @Test
    fun `EVM-130 AC1 arming is idempotent - the progress and the owner of an existing job are kept`() {
        val store = JobFileStore(UploadFiles(root))
        store.arm(jobOf())
        store.save(snapshotOf())
        val again = store.arm(jobOf().copy(userId = "someone-else"))
        assertEquals("user-1", again.userId)
        assertEquals(snapshotOf(), again.snapshot)
        assertEquals(listOf(ASSET_A), store.list().map { it.assetId })
    }

    @Test
    fun `EVM-130 AC1 the store is the job store of the engine - load, save, clear, and a vanished file is a gone job`() {
        val store = JobFileStore(UploadFiles(root))
        assertNull(store.load(ASSET_A))
        assertThrows(JobFileGoneException::class.java) { store.save(snapshotOf()) }
        assertThrows(JobFileGoneException::class.java) { store.clear(ASSET_A) }
        store.arm(jobOf())
        assertNull(store.load(ASSET_A))
        store.save(snapshotOf())
        assertEquals(snapshotOf(), store.load(ASSET_A))
        store.clear(ASSET_A)
        assertNull(store.read(ASSET_A)?.snapshot)
        assertEquals("device-1", store.read(ASSET_A)?.deviceId)
        assertEquals("user-1:device-1", store.read(ASSET_A)?.ownerId)
    }

    @Test
    fun `EVM-130 AC1 an unreadable job file is skipped by the list and read as nothing`() {
        val files = UploadFiles(root)
        val store = JobFileStore(files)
        store.arm(jobOf(ASSET_A))
        store.arm(jobOf(ASSET_B))
        files.jobFile(ASSET_B).writeText("{ broken")
        File(files.jobsDirectory, "notes.txt").writeText("x")
        File(files.jobsDirectory, "folder.json").mkdirs()
        File(files.jobsDirectory, "$ASSET_A-big.json").writeBytes(ByteArray(300_000))
        assertNull(store.read(ASSET_B))
        assertEquals(listOf(ASSET_A), store.list().map { it.assetId })
        assertEquals(emptyList<JobFileData>(), JobFileStore(UploadFiles(File(root, "empty"))).list())
    }

    @Test
    fun `EVM-130 AC4 deleting a job removes its file and its original, and nothing else`() {
        val files = UploadFiles(root)
        val store = JobFileStore(files)
        store.arm(jobOf(ASSET_A))
        store.arm(jobOf(ASSET_B))
        files.originalFile(ASSET_A).apply { parentFile.mkdirs() }.writeText("bytes")
        files.originalFile(ASSET_B).writeText("bytes")
        store.delete(ASSET_A)
        assertFalse(files.jobFile(ASSET_A).exists() || files.originalFile(ASSET_A).exists())
        assertTrue(files.jobFile(ASSET_B).exists() && files.originalFile(ASSET_B).exists())
        store.delete(ASSET_A)
    }

    @Test
    fun `EVM-130 AC3 the codec rejects a file with an unknown version, unknown or missing keys, bad identifiers or a negative size`() {
        val good = JobFileCodec.encode(jobOf(snapshot = snapshotOf()))
        assertEquals(jobOf(snapshot = snapshotOf()), JobFileCodec.decode(good))
        val fields = Json.obj(Json.parse(String(good)))

        fun variant(change: (MutableMap<String, Any?>) -> Unit): ByteArray =
            Json.stringify(fields.toMutableMap().also(change)).toByteArray()
        val bad =
            listOf(
                variant { it["fileSchemaVersion"] = 2 },
                variant { it["extra"] = "x" },
                variant { it.remove("userId") },
                variant { it["userId"] = "a/b" },
                variant { it["assetId"] = "asset-1" },
                variant { it["assetId"] = 5 },
                variant { it["deviceId"] = "x y" },
                variant { it["workOrderId"] = "x y" },
                variant { it["workOrderId"] = 5 },
                variant { it["size"] = -1 },
                variant { it["size"] = "40" },
                "[]".toByteArray(),
                "not json".toByteArray(),
            )
        bad.forEachIndexed { index, bytes -> assertNull(JobFileCodec.decode(bytes), "variant $index") }
    }

    @Test
    fun `EVM-130 AC1 a snapshot of the engine that does not fit is dropped but the header and the owner stay`() {
        val fields = Json.obj(Json.parse(String(JobFileCodec.encode(jobOf(snapshot = snapshotOf())))))
        val snapshot = Json.obj(fields["snapshot"])

        fun withSnapshot(change: (MutableMap<String, Any?>) -> Unit): JobFileData? {
            val changed = snapshot.toMutableMap().also(change)
            return JobFileCodec.decode(Json.stringify(fields + ("snapshot" to changed)).toByteArray())
        }
        for (
        change in
        listOf<(MutableMap<String, Any?>) -> Unit>(
            { it["extra"] = 1 },
            { it.remove("size") },
            { it["assetId"] = ASSET_B },
            { it["uploadSessionId"] = "a/b" },
            { it["idempotencyKey"] = "https://x" },
            { it["etags"] = mapOf("x" to "\"e\"") },
            { it["etags"] = mapOf("1" to "bad value") },
            { it["state"] = "teleported" },
        )
        ) {
            val data = withSnapshot(change)
            assertNotNull(data)
            assertNull(data?.snapshot)
            assertEquals("user-1", data?.userId)
        }
        assertEquals(snapshotOf(), withSnapshot { }?.snapshot)
        assertNull(JobFileCodec.decode(Json.stringify(fields + ("snapshot" to "x")).toByteArray())?.snapshot)
    }

    @Test
    fun `EVM-130 AC3 a job file is written atomically - a leftover temporary file never counts as a job`() {
        val files = UploadFiles(root)
        val store = JobFileStore(files)
        store.arm(jobOf())
        File(files.jobsDirectory, "$ASSET_B.json.tmp").writeText("half")
        assertEquals(listOf(ASSET_A), store.list().map { it.assetId })
    }
}
