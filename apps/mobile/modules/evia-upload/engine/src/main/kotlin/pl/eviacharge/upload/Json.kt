package pl.eviacharge.upload

/** The input is not valid JSON (or too deep). The message never carries the input: it may hold a token or a signed address. */
class JsonException : Exception("invalid json") {
    override fun fillInStackTrace(): Throwable = this
}

private const val MAX_DEPTH = 32
private const val UNICODE_ESCAPE_LENGTH = 4
private const val HEX_RADIX = 16
private const val FIRST_PRINTABLE = 0x20

/**
 * Minimal JSON reader and writer of the engine (no org.json and no other dependency, ADR-0020). Objects become `Map<String, Any?>`
 * (insertion order kept), arrays `List<Any?>`, integers `Long`, other numbers `Double`. Any malformed input is a [JsonException]; the
 * nesting is limited, so an answer of a server cannot exhaust the stack. The size limit is the business of the caller (it reads at most
 * 1 MiB of an answer).
 */
object Json {
    @Throws(JsonException::class)
    fun parse(text: String): Any? {
        try {
            val reader = Reader(text)
            val value = reader.value(0)
            reader.skipSpace()
            if (!reader.atEnd()) throw JsonException()
            return value
        } catch (error: JsonException) {
            throw error
        } catch (error: IndexOutOfBoundsException) {
            throw JsonException()
        } catch (error: NumberFormatException) {
            throw JsonException()
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun obj(value: Any?): Map<String, Any?> = value as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    fun list(value: Any?): List<Any?> = value as List<Any?>

    /** Writes a value built of maps, lists, strings, numbers, booleans and null. Anything else is a programming error. */
    fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(
        out: StringBuilder,
        value: Any?,
    ) {
        when (value) {
            null -> out.append("null")
            is String -> writeString(out, value)
            is Boolean, is Int, is Long -> out.append(value.toString())
            is Double -> out.append(requireFinite(value).toString())
            is Map<*, *> -> writeAll(out, '{', '}', value.entries) { entry -> writeEntry(out, entry) }
            is List<*> -> writeAll(out, '[', ']', value) { item -> write(out, item) }
            else -> throw IllegalArgumentException("unsupported json value")
        }
    }

    private fun requireFinite(value: Double): Double {
        require(value.isFinite()) { "unsupported json value" }
        return value
    }

    private fun writeEntry(
        out: StringBuilder,
        entry: Map.Entry<*, *>,
    ) {
        writeString(out, entry.key as? String ?: throw IllegalArgumentException("unsupported json key"))
        out.append(':')
        write(out, entry.value)
    }

    private fun <T> writeAll(
        out: StringBuilder,
        open: Char,
        close: Char,
        items: Iterable<T>,
        each: (T) -> Unit,
    ) {
        out.append(open)
        var first = true
        for (item in items) {
            if (!first) out.append(',')
            first = false
            each(item)
        }
        out.append(close)
    }

    private fun writeString(
        out: StringBuilder,
        text: String,
    ) {
        out.append('"')
        for (c in text) {
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c.code < FIRST_PRINTABLE -> out.append("\\u").append(c.code.toString(HEX_RADIX).padStart(UNICODE_ESCAPE_LENGTH, '0'))
                else -> out.append(c)
            }
        }
        out.append('"')
    }

    private class Reader(
        private val text: String,
    ) {
        private var position = 0

        fun atEnd() = position >= text.length

        fun skipSpace() {
            while (position < text.length && text[position].isWhitespace()) position++
        }

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) throw JsonException()
            skipSpace()
            return when (val c = text[position]) {
                '{' -> objectValue(depth)
                '[' -> arrayValue(depth)
                '"' -> stringValue()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) numberValue() else throw JsonException()
            }
        }

        private fun literal(
            word: String,
            result: Any?,
        ): Any? {
            if (!text.startsWith(word, position)) throw JsonException()
            position += word.length
            return result
        }

        private fun objectValue(depth: Int): Map<String, Any?> {
            val result = linkedMapOf<String, Any?>()
            position++
            skipSpace()
            if (text[position] == '}') {
                position++
                return result
            }
            while (true) {
                skipSpace()
                val key = stringValue()
                skipSpace()
                if (text[position++] != ':') throw JsonException()
                result[key] = value(depth + 1)
                skipSpace()
                when (text[position++]) {
                    ',' -> continue
                    '}' -> return result
                    else -> throw JsonException()
                }
            }
        }

        private fun arrayValue(depth: Int): List<Any?> {
            val result = mutableListOf<Any?>()
            position++
            skipSpace()
            if (text[position] == ']') {
                position++
                return result
            }
            while (true) {
                result.add(value(depth + 1))
                skipSpace()
                when (text[position++]) {
                    ',' -> continue
                    ']' -> return result
                    else -> throw JsonException()
                }
            }
        }

        private fun stringValue(): String {
            if (text[position++] != '"') throw JsonException()
            val builder = StringBuilder()
            while (true) {
                when (val c = text[position++]) {
                    '"' -> return builder.toString()
                    '\\' -> builder.append(escape())
                    else -> builder.append(c)
                }
            }
        }

        private fun escape(): Char =
            when (val escaped = text[position++]) {
                'n' -> '\n'
                't' -> '\t'
                'r' -> '\r'
                'b' -> '\b'
                'f' -> '\u000c'
                'u' -> unicode()
                '"', '\\', '/' -> escaped
                else -> throw JsonException()
            }

        private fun unicode(): Char {
            val code = text.substring(position, position + UNICODE_ESCAPE_LENGTH).toInt(HEX_RADIX)
            position += UNICODE_ESCAPE_LENGTH
            return code.toChar()
        }

        private fun numberValue(): Any {
            val start = position
            while (position < text.length && (text[position].isDigit() || text[position] in "+-.eE")) position++
            val token = text.substring(start, position)
            val number = token.toLongOrNull() ?: token.toDouble()
            if (number is Double && !number.isFinite()) throw JsonException()
            return number
        }
    }
}
