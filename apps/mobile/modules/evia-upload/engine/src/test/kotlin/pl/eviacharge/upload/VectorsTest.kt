package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Conformance vectors shared with the TypeScript model (`packages/sync-core/conformance/upload`). A divergence of any vector turns a
 * test red on either side (EVM-109 AC4). The Gradle task declares the directory as an input, so a changed vector reruns these tests.
 */
class VectorsTest {
    @Test
    fun `EVM-109 AC4 the vectors directory exists and every vector file is listed in index_json and exists`() {
        assertTrue(Vectors.directory.isDirectory)
        assertEquals(Vectors.onDisk(), Vectors.indexed().sorted())
        Vectors.indexed().forEach { assertTrue(File(Vectors.directory, it).isFile, "listed vector file is missing: $it") }
    }

    @Test
    fun `EVM-109 AC4 a missing vector file fails instead of passing silently`() {
        assertThrows(IllegalStateException::class.java) { Vectors.read("does-not-exist.json") }
    }

    @TestFactory
    fun planning(): List<DynamicTest> =
        Json.list(Vectors.read("planning.json")["cases"]).map { raw ->
            val case = Json.obj(raw)
            dynamicTest("EVM-109 AC4 ${case["id"]}") {
                val input = Json.obj(case["input"])
                val expected = Json.obj(case["expected"])
                val size = (input["size"] as Number).toLong()
                val partSize = (input["partSize"] as Number).toLong()
                val partCount = (input["partCount"] as Number).toInt()
                if (expected.containsKey("error")) {
                    assertThrows(PlanMismatchException::class.java) { planParts(size, partSize, partCount) }
                } else {
                    val parts = planParts(size, partSize, partCount)
                    assertEquals(expected["count"], parts.size.toLong())
                    assertEquals(expected["total"], parts.sumOf { it.length })
                    assertEquals(rangeWire(expected["first"]), parts.first())
                    assertEquals(rangeWire(expected["last"]), parts.last())
                    if (expected.containsKey("parts")) assertEquals(Json.list(expected["parts"]).map { rangeWire(it) }, parts)
                }
            }
        }

    private fun rangeWire(value: Any?): PartRange {
        val range = Json.obj(value)
        return PartRange(
            (range["partNumber"] as Number).toInt(),
            (range["offset"] as Number).toLong(),
            (range["length"] as Number).toLong(),
        )
    }

    @Test
    fun `EVM-109 AC4 the constants of the engine equal the constants in the backoff vector`() {
        val constants = Json.obj(Vectors.read("backoff.json")["constants"])
        assertEquals(
            normalize(
                mapOf(
                    "maxAttempts" to UploadLimits.MAX_ATTEMPTS,
                    "maxRenewals" to UploadLimits.MAX_RENEWALS,
                    "baseMs" to UploadLimits.BASE_DELAY_MS,
                    "capMs" to UploadLimits.CAP_DELAY_MS,
                    "maxParts" to UploadLimits.MAX_PARTS,
                ),
            ),
            normalize(constants),
        )
    }

    @TestFactory
    fun backoff(): List<DynamicTest> =
        Json.list(Vectors.read("backoff.json")["cases"]).map { raw ->
            val case = Json.obj(raw)
            dynamicTest("EVM-109 AC4 attempt ${case["attempt"]} rng ${case["rng"]}") {
                val attempt = (case["attempt"] as Number).toInt()
                assertEquals((case["expected"] as Number).toLong(), backoffDelayMs(attempt, (case["rng"] as Number).toDouble()))
            }
        }

    @TestFactory
    fun mapping(): List<DynamicTest> =
        Json.list(Vectors.read("mapping.json")["cases"]).map { raw ->
            val case = Json.obj(raw)
            dynamicTest("EVM-109 AC2 ${case["id"]}") {
                val input = Json.obj(case["input"])
                val mapped =
                    when (input["kind"]) {
                        "network" -> {
                            Failure.Network
                        }

                        "http" -> {
                            Failure.Http(
                                (input["status"] as Number).toInt(),
                                input["code"] as? String,
                                (input["retryAfterSeconds"] as? Number)?.toLong(),
                            )
                        }

                        else -> {
                            FileState(input["state"] as String, input["reasonCode"] as? String)
                        }
                    }
                assertEquals(normalize(case["expected"]), normalize(outcomeWire(mapFailure(mapped))))
            }
        }

    @TestFactory
    fun urlcheck(): List<DynamicTest> {
        val file = Vectors.read("urlcheck.json")
        val hosts = Json.list(file["allowedHosts"]).map { it as String }
        return Json.list(file["cases"]).map { raw ->
            val case = Json.obj(raw)
            dynamicTest("EVM-109 AC3 ${case["id"]}") {
                val repeat = case["urlRepeat"]?.let { Json.obj(it) }
                val url =
                    (case["url"] as? String)
                        ?: ((repeat?.get("prefix") as String) + (repeat["filler"] as String).repeat((repeat["times"] as Number).toInt()))
                assertEquals(case["trusted"], isTrustedPartUrl(url, hosts))
            }
        }
    }

    @TestFactory
    fun resume(): List<DynamicTest> {
        val file = Vectors.read("resume.json")
        val defaults = Json.obj(file["defaults"])
        return Json.list(file["scenarios"]).map { raw ->
            val scenario = Json.obj(raw)
            dynamicTest("EVM-109 ${scenario["ac"]} ${scenario["id"]}") {
                assertEquals(emptyList<String>(), runScenario(scenario, defaults))
            }
        }
    }

    @Test
    fun `EVM-109 AC4 a changed expectation is reported as a mismatch`() {
        val file = Vectors.read("resume.json")
        val defaults = Json.obj(file["defaults"])
        val scenario = Json.obj(Json.list(file["scenarios"]).first())
        val changed = scenario + ("final" to (Json.obj(scenario["final"]) + ("objects" to 2L)))
        assertTrue(runScenario(changed, defaults).isNotEmpty())
        val run = Json.obj(Json.list(scenario["runs"]).first())
        val expect = Json.obj(run["expect"])
        val wrongCalls = scenario + ("runs" to listOf(run + ("expect" to (expect + ("calls" to listOf("put:1"))))))
        assertTrue(runScenario(wrongCalls, defaults).isNotEmpty())
    }
}
