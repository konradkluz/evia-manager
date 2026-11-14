package pl.eviacharge.upload

/**
 * Minimal JSON reader for the conformance vectors (test code only, so the engine gets no JSON dependency). Objects become
 * `Map<String, Any?>` (insertion order kept), arrays `List<Any?>`, integers `Long`, other numbers `Double`.
 */
object Json {
    fun parse(text: String): Any? {
        val reader = Reader(text)
        val value = reader.value()
        reader.skipSpace()
        check(reader.atEnd()) { "trailing characters at ${reader.position}" }
        return value
    }

    @Suppress("UNCHECKED_CAST")
    fun obj(value: Any?): Map<String, Any?> = value as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    fun list(value: Any?): List<Any?> = value as List<Any?>

    private class Reader(
        private val text: String,
    ) {
        var position = 0

        fun atEnd() = position >= text.length

        fun skipSpace() {
            while (position < text.length && text[position].isWhitespace()) position++
        }

        fun value(): Any? {
            skipSpace()
            return when (val c = text[position]) {
                '{' -> objectValue()
                '[' -> arrayValue()
                '"' -> stringValue()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) numberValue() else error("unexpected '$c' at $position")
            }
        }

        private fun literal(
            word: String,
            result: Any?,
        ): Any? {
            check(text.startsWith(word, position)) { "bad literal at $position" }
            position += word.length
            return result
        }

        private fun objectValue(): Map<String, Any?> {
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
                check(text[position++] == ':') { "expected ':' at $position" }
                result[key] = value()
                skipSpace()
                when (text[position++]) {
                    ',' -> continue
                    '}' -> return result
                    else -> error("expected ',' or '}' at $position")
                }
            }
        }

        private fun arrayValue(): List<Any?> {
            val result = mutableListOf<Any?>()
            position++
            skipSpace()
            if (text[position] == ']') {
                position++
                return result
            }
            while (true) {
                result.add(value())
                skipSpace()
                when (text[position++]) {
                    ',' -> continue
                    ']' -> return result
                    else -> error("expected ',' or ']' at $position")
                }
            }
        }

        private fun stringValue(): String {
            check(text[position++] == '"') { "expected string at $position" }
            val builder = StringBuilder()
            while (true) {
                when (val c = text[position++]) {
                    '"' -> {
                        return builder.toString()
                    }

                    '\\' -> {
                        when (val escaped = text[position++]) {
                            'n' -> {
                                builder.append('\n')
                            }

                            't' -> {
                                builder.append('\t')
                            }

                            'r' -> {
                                builder.append('\r')
                            }

                            'b' -> {
                                builder.append('\b')
                            }

                            'f' -> {
                                builder.append('\u000c')
                            }

                            'u' -> {
                                builder.append(text.substring(position, position + 4).toInt(16).toChar())
                                position += 4
                            }

                            else -> {
                                builder.append(escaped)
                            }
                        }
                    }

                    else -> {
                        builder.append(c)
                    }
                }
            }
        }

        private fun numberValue(): Any {
            val start = position
            while (position < text.length && (text[position].isDigit() || text[position] in "+-.eE")) position++
            val token = text.substring(start, position)
            return token.toLongOrNull() ?: token.toDouble()
        }
    }
}
