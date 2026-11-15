package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import pl.eviacharge.upload.files.UploadTypes

private const val ASSET = "0193a000-0000-7000-8000-00000000000a"

/** EVM-131 AC1 (EVM-130 A2): the declaration of the file of the session - the allow-list, the name made from the asset, the mapping of a refusal. */
class DeclarationTest {
    @TestFactory
    fun vectors(): List<DynamicTest> =
        Json.list(Vectors.read("declaration.json")["types"]).map { raw ->
            val case = Json.obj(raw)
            DynamicTest.dynamicTest(case["id"] as String) {
                assertEquals(case["normalized"], UploadTypes.normalize(case["input"] as String))
                (case["fileName"] as? String)?.let { assertEquals(it, UploadTypes.fileNameFor(ASSET, case["normalized"] as String)) }
            }
        }

    @TestFactory
    fun declarable(): List<DynamicTest> =
        Json.list(Vectors.read("declaration.json")["declarations"]).map { raw ->
            val case = Json.obj(raw)
            val file = Json.obj(case["file"])
            DynamicTest.dynamicTest(case["id"] as String) {
                val declaration =
                    FileDeclaration(
                        file["fileName"] as String,
                        (file["declaredSize"] as Number).toLong(),
                        file["contentType"] as String,
                        file["sha256"] as String,
                    )
                assertEquals(case["declarable"], UploadTypes.isDeclarable(declaration))
            }
        }

    @Test
    fun `EVM-131 AC1 the files of the vectors are all listed, and a type outside the list has no extension but bin`() {
        assertTrue("declaration.json" in Vectors.indexed())
        assertEquals("$ASSET.bin", UploadTypes.fileNameFor(ASSET, "image/svg+xml"))
        assertNull(UploadTypes.normalize(""))
        assertEquals("image/jpeg", UploadTypes.normalize("  Image/JPG "))
        assertTrue(UploadTypes.isSha256(TEST_SHA))
        assertFalse(UploadTypes.isSha256(TEST_SHA + "0"))
    }

    @Test
    fun `EVM-131 AC2 a refusal of the declaration by the server is needs_attention with its own reason, never a retry`() {
        val refusal = mapFailure(Failure.Http(400, "validation_failed"))
        assertEquals(Outcome.NeedsAttention(AttentionReason.DECLARATION_REJECTED), refusal)
        assertEquals("declaration_rejected", AttentionReason.DECLARATION_REJECTED.code)
        // a 400 without that code stays unknown
        assertEquals(Outcome.NeedsAttention(AttentionReason.UNKNOWN), mapFailure(Failure.Http(400)))
        assertEquals(Outcome.NeedsAttention(AttentionReason.UNKNOWN), mapFailure(Failure.Http(400, "bad_request")))
    }
}
