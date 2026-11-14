package pl.eviacharge.upload

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** The rules of the module that no test of behaviour can show: what the sources must never contain (security 4, 5). */
class SourceRulesTest {
    private val sources: List<Pair<String, String>> by lazy {
        val root = File(checkNotNull(System.getProperty("evia.module.root")), "src/main/kotlin")
        root
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .map { it.name to withoutComments(it.readText()) }
            .toList()
    }

    /** A comment may name what the code must not do: the rules look at code only. */
    private fun withoutComments(text: String) = text.replace(Regex("(?s)/\\*.*?\\*/"), "").replace(Regex("(?m)\\s//\\s.*$"), "")

    @Test
    fun `EVM-130 AC2 the HTTP client has no own trust manager, hostname verifier or socket factory - the system store decides`() {
        assertTrue(sources.size > 20)
        val forbidden = Regex("TrustManager|HostnameVerifier|SSLContext|SSLSocketFactory|setDefaultHostnameVerifier|trustAll|X509")
        assertEquals(emptyList<String>(), sources.filter { forbidden.containsMatchIn(it.second) }.map { it.first })
    }

    @Test
    fun `EVM-130 AC5 the engine does not log by itself, does not print and does not follow redirects`() {
        val forbidden =
            Regex(
                "android\\.util\\.Log|System\\.out|System\\.err|printStackTrace|println\\(|java\\.util\\.logging|instanceFollowRedirects\\s*=\\s*true|setFollowRedirects",
            )
        assertEquals(emptyList<String>(), sources.filter { forbidden.containsMatchIn(it.second) }.map { it.first })
        assertTrue(sources.any { it.second.contains("instanceFollowRedirects = false") })
    }

    @Test
    fun `EVM-130 AC2 the sources use no library but the JDK and the Kotlin stdlib`() {
        val imports =
            sources
                .flatMap { (_, text) ->
                    Regex("(?m)^import ([\\w.]+)").findAll(text).map { it.groupValues[1] }.toList()
                }.toSet()
        val foreign =
            imports.filter {
                !it.startsWith("java.") && !it.startsWith("javax.") && !it.startsWith("kotlin.") &&
                    !it.startsWith("pl.eviacharge.")
            }
        assertEquals(emptyList<String>(), foreign)
        assertNull(imports.firstOrNull { it.startsWith("android.") || it.startsWith("org.json") })
    }
}
