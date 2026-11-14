package pl.eviacharge.upload.http

private val INSTANT = Regex("^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,9}))?Z$")
private const val DAYS_FROM_0000_TO_1970 = 719_468L
private const val DAYS_PER_ERA = 146_097L
private const val MS_PER_SECOND = 1000L
private const val SECONDS_PER_DAY = 86_400L
private const val DAYS_PER_YEAR_CYCLE = 365L

/**
 * `YYYY-MM-DDThh:mm:ss[.fraction]Z` (UTC, as the contract says) to epoch milliseconds, without `java.time` (the same code runs on the
 * JVM of the tests and on every supported Android). `null` for anything else.
 */
internal object Iso8601 {
    fun parse(text: String?): Long? {
        val match = INSTANT.matchEntire(text ?: return null) ?: return null
        val (yearText, monthText, dayText, hourText, minuteText, secondText) = match.destructured
        val year = yearText.toInt()
        val month = monthText.toInt()
        val day = dayText.toInt()
        val hour = hourText.toInt()
        val minute = minuteText.toInt()
        val second = secondText.toInt()
        if (month !in 1..12 || day !in 1..daysIn(year, month) || hour > 23 || minute > 59 || second > 59) return null
        val fraction = match.groupValues[7]
        val millis = if (fraction.isEmpty()) 0L else fraction.padEnd(3, '0').take(3).toLong()
        val seconds = daysFromCivil(year, month, day) * SECONDS_PER_DAY + hour * 3600L + minute * 60L + second
        return seconds * MS_PER_SECOND + millis
    }

    private fun daysIn(
        year: Int,
        month: Int,
    ): Int =
        when (month) {
            2 -> if (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }

    /** Days since 1970-01-01 of a date of the proleptic Gregorian calendar (the algorithm of H. Hinnant). */
    private fun daysFromCivil(
        year: Int,
        month: Int,
        day: Int,
    ): Long {
        val y = (if (month <= 2) year - 1 else year).toLong()
        val era = (if (y >= 0) y else y - 399) / 400
        val yearOfEra = y - era * 400
        val shifted = if (month > 2) month - 3 else month + 9
        val dayOfYear = (153 * shifted + 2) / 5 + day - 1
        val dayOfEra = yearOfEra * DAYS_PER_YEAR_CYCLE + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * DAYS_PER_ERA + dayOfEra - DAYS_FROM_0000_TO_1970
    }
}
