package pl.eviacharge.upload.notification

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class NotificationTextTest {
    @Test
    fun `EVM-130 AC6 the four texts of the notification are exactly as specified`() {
        assertEquals("Wysyłanie 3 z 12 plików", NotificationText.progress(3, 12))
        assertEquals("Wysłano 12 plików", NotificationText.sent(12))
        assertEquals("Nie wysłano 2 plików — otwórz aplikację", NotificationText.failed(2))
        assertEquals("Wysyłanie wstrzymane — zaloguj się w aplikacji", NotificationText.PAUSED)
        assertEquals("EVia Manager", NotificationText.PUBLIC_TITLE)
    }

    @Test
    fun `EVM-130 AC6 plural forms follow one, few and many (1 plik, 2-4 pliki, 5+ plików, 22 pliki, 12 plików)`() {
        assertEquals("Wysłano 1 plik", NotificationText.sent(1))
        assertEquals("Wysłano 2 pliki", NotificationText.sent(2))
        assertEquals("Wysłano 4 pliki", NotificationText.sent(4))
        assertEquals("Wysłano 5 plików", NotificationText.sent(5))
        assertEquals("Wysłano 12 plików", NotificationText.sent(12))
        assertEquals("Wysłano 14 plików", NotificationText.sent(14))
        assertEquals("Wysłano 22 pliki", NotificationText.sent(22))
        assertEquals("Wysłano 111 plików", NotificationText.sent(111))
        assertEquals("Wysłano 0 plików", NotificationText.sent(0))
    }

    @Test
    fun `EVM-130 AC6 after z and after a negation the genitive is used`() {
        assertEquals("Wysyłanie 1 z 1 pliku", NotificationText.progress(1, 1))
        assertEquals("Wysyłanie 1 z 3 plików", NotificationText.progress(1, 3))
        assertEquals("Nie wysłano 1 pliku — otwórz aplikację", NotificationText.failed(1))
        assertEquals("Nie wysłano 3 plików — otwórz aplikację", NotificationText.failed(3))
    }

    @Test
    fun `EVM-130 AC6 no text carries digits other than counts, an order number or an address`() {
        val all = listOf(NotificationText.progress(3, 12), NotificationText.sent(12), NotificationText.failed(2), NotificationText.PAUSED)
        all.forEach { assertFalse(Regex("https?://|@|zlecenie|\.jpg|\.mp4", RegexOption.IGNORE_CASE).containsMatchIn(it), it) }
    }
}
