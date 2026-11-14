package pl.eviacharge.upload.notification

/**
 * The texts of the upload notification (EVM-130 AC6; makieta 09, styleguide 6.3): no order numbers, names, addresses or thumbnails, only
 * counts. Plural forms follow the Polish CLDR categories (one / few / many), never "plik(i)". The title of the public version is [PUBLIC_TITLE].
 */
object NotificationText {
    const val PUBLIC_TITLE = "EVia Manager"
    const val PAUSED = "Wysyłanie wstrzymane — zaloguj się w aplikacji"

    fun progress(
        done: Int,
        total: Int,
    ): String = "Wysyłanie $done z $total ${genitive(total)}"

    fun sent(count: Int): String = "Wysłano $count ${nominative(count)}"

    fun failed(count: Int): String = "Nie wysłano $count ${genitive(count)} — otwórz aplikację"

    private enum class Plural { ONE, FEW, MANY }

    private fun category(count: Int): Plural {
        val lastTwo = count % 100
        val last = count % 10
        return when {
            count == 1 -> Plural.ONE
            last in 2..4 && lastTwo !in 12..14 -> Plural.FEW
            else -> Plural.MANY
        }
    }

    private fun nominative(count: Int): String =
        when (category(count)) {
            Plural.ONE -> "plik"
            Plural.FEW -> "pliki"
            Plural.MANY -> "plików"
        }

    /** After "z" and after a negation the noun is in the genitive: "z 1 pliku", "z 12 plików". */
    private fun genitive(count: Int): String = if (count == 1) "pliku" else "plików"
}
