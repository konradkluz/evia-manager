package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The JSON of the engine: parsing of answers of a server and writing of files. */
class JsonTest {
    @Test
    fun `EVM-130 AC3 JSON is parsed into maps, lists, strings, numbers, booleans and null`() {
        val value = Json.obj(Json.parse(""" {"a":[1,2.5,-3,"x\n\t\r\b\f\"\\\/\u0041",true,false,null],"b":{},"c":[],"d":1e2} """))
        assertEquals(listOf(1L, 2.5, -3L, "x\n\t\r\b\u000c\"\\/A", true, false, null), Json.list(value["a"]))
        assertEquals(emptyMap<String, Any?>(), Json.obj(value["b"]))
        assertEquals(emptyList<Any?>(), Json.list(value["c"]))
        assertEquals(100.0, value["d"])
    }

    @Test
    fun `EVM-130 AC3 malformed JSON is a JsonException without the input in its message`() {
        val bad =
            listOf(
                "",
                " ",
                "{",
                "[",
                "{\"a\"}",
                "{\"a\":1",
                "{\"a\":1 \"b\":2}",
                "{1:2}",
                "[1 2]",
                "[1,",
                "\"abc",
                "\"\\x\"",
                "\"\\u12\"",
                "\"\\uZZZZ\"",
                "tru",
                "nul",
                "x",
                "1 2",
                "{} x",
                "-",
                "1e999",
                "1.2.3",
            )
        for (text in bad) {
            val error = assertThrows(JsonException::class.java, { Json.parse(text) }, text)
            assertEquals("invalid json", error.message)
        }
        assertThrows(JsonException::class.java) { Json.parse("[".repeat(100) + "]".repeat(100)) }
        assertTrue(JsonException().fillInStackTrace() is JsonException)
    }

    @Test
    fun `EVM-130 AC3 nesting up to the limit is accepted, deeper is refused instead of overflowing the stack`() {
        assertTrue(Json.parse("[".repeat(30) + "]".repeat(30)) is List<*>)
        assertThrows(JsonException::class.java) { Json.parse("[".repeat(40) + "]".repeat(40)) }
    }

    @Test
    fun `EVM-130 AC3 writing escapes strings and control characters, and reading gives the same value back`() {
        val value = mapOf("s" to "a\"b\\c\u0001\n", "n" to null, "l" to listOf(1L, 2, 2.5, true), "m" to mapOf("k" to "v"))
        val text = Json.stringify(value)
        assertEquals(
            mapOf("s" to "a\"b\\c\u0001\n", "n" to null, "l" to listOf(1L, 2L, 2.5, true), "m" to mapOf("k" to "v")),
            Json.parse(text),
        )
        assertTrue(text.contains("\\u0001"))
        assertEquals("[]", Json.stringify(emptyList<Any?>()))
        assertEquals("{}", Json.stringify(emptyMap<String, Any?>()))
    }

    @Test
    fun `EVM-130 AC3 only values of JSON can be written - anything else, NaN and a key that is not a string are programming errors`() {
        assertThrows(IllegalArgumentException::class.java) { Json.stringify(Any()) }
        assertThrows(IllegalArgumentException::class.java) { Json.stringify(Double.NaN) }
        assertThrows(IllegalArgumentException::class.java) { Json.stringify(mapOf(1 to 2)) }
        assertEquals("1.5", Json.stringify(1.5))
    }
}
