---
id: EVM-105
title: "Aplikacja: wpisy i komentarze offline"
type: story
milestone: M2
epic: E12 Wpisy offline
status: in-progress
priority: P1
path: pelna             # synchronizacja offline, treść wpisów (dane osobowe) w kolejce na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet           # formularz i zapis do gotowej kolejki (EVM-107); „Wymaga uwagi” już jest
depends_on: [EVM-104, EVM-107]
---

# EVM-105: Aplikacja — wpisy i komentarze offline

## Cel
Jako **technik** chcę **dopisać wpis (kategoria, treść, opcjonalnie etap) lub komentarz bez zasięgu**, aby **to, co ustalę na miejscu, trafiło do dziennika zlecenia bez ponownego pisania**. Makieta M-04 ([`05-wpis-i-komentarz.md`](../../ux/flows/05-wpis-i-komentarz.md)). Kolejka, wysyłka i ekran „Wymaga uwagi” (z akcjami „Dodaj do innego zlecenia”, „Kopiuj treść”, „Usuń z telefonu”) już istnieją (EVM-107); ta historyjka dodaje formularz, zapis do kolejki i pokazanie oczekujących elementów w dzienniku M-03 (EVM-104).

## Kryteria akceptacji

**AC1 — Wpis offline**
- Zakładając brak sieci, zalogowanego technika (Administrator lub Edytor) i otwarte zlecenie (także rozliczone lub anulowane — wpisy tam nadal wolno dodawać)
- Gdy dotykam „Dodaj wpis”, wybieram kategorię (Rozmowa telefoniczna, Spotkanie, Ustalenie, Wizyta na miejscu, Inne; domyślnie „Inne”), opcjonalnie etap tego zlecenia, wpisuję treść i zapisuję
- Wtedy `CreateNote` (z czasem zapisu na telefonie) trafia do trwałej kolejki przed zamknięciem formularza, toast brzmi „Zapisano w telefonie. Wyślemy, gdy wróci zasięg.” (ogłoszony czytnikowi), wpis jest od razu widoczny w dzienniku jako „Czeka na wysłanie”, a po powrocie sieci wysyła się dokładnie raz i zamienia w zwykły wpis bez duplikatu.

**AC2 — Komentarz**
- Zakładając otwarte zlecenie
- Gdy przełączam formularz na „Komentarz” (bez kategorii i etapu), wpisuję treść i zapisuję
- Wtedy działa jak w AC1 z komendą `CreateComment`.

**AC3 — Walidacja**
- Zakładając treść pustą (same białe znaki) albo dłuższą niż limit komendy (10 000 znaków)
- Gdy próbuję zapisać
- Wtedy dostaję komunikat przy polu („Wpisz treść wpisu.” / informację o limicie), fokus trafia na pole, a nic nie trafia do kolejki; formularz ma stałą podpowiedź „Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.”.

**AC4 — Wejścia i cel wpisu**
- Zakładając zlecenia w telefonie
- Gdy wchodzę w formularz z M-03 („Dodaj wpis”) albo z przycisku „Dodaj → Wpis”
- Wtedy z M-03 zlecenie jest już wybrane, a z „Dodaj → Wpis” najpierw wybieram zlecenie z listy zapisanej w telefonie (numer i tytuł, bez danych osobowych, ten sam wybór co „Dodaj do innego zlecenia”; brak zleceń: komunikat zamiast listy); w trybie ukrytych danych formularz jest niedostępny (EmptyState; dane zleceń nie są renderowane), a wejście w tryb przy otwartym formularzu zamyka go i zeruje wpisaną treść (nie ma szkicu poza kolejką).

**AC5 — Przetrwanie zabicia aplikacji**
- Zakładając wpis zapisany offline
- Gdy aplikacja zostaje zamknięta siłą przed wysłaniem, a potem uruchomiona z zasięgiem
- Wtedy wpis nadal czeka w kolejce i zostaje wysłany raz (przepływ Maestro na emulatorze, zgodnie z EVM-107 AC6).

**AC6 — Odrzucenie**
- Zakładając wpis lub komentarz, którego zlecenie zostało usunięte w biurze przed wysłaniem (`rejected`)
- Gdy serwer odrzuca element
- Wtedy trafia on do „Wymaga uwagi” z powodem prostymi słowami („Zlecenie zostało usunięte albo nie masz do niego dostępu.”), podglądem treści i czasu dodania oraz akcjami „Dodaj do innego zlecenia”, „Kopiuj treść” i oddzielnie „Usuń z telefonu” (istniejący mechanizm EVM-107 — tu test przepływu od formularza do odrzucenia i przeniesienia); w dzienniku zlecenia (jeśli jest jeszcze w telefonie) element ma oznaczenie „Wymaga uwagi” z „Przejdź do kolejki”.

## Poza zakresem
- Edycja i usuwanie wpisu z telefonu (redakcja w panelu — EVM-040), załączniki, zdjęcia (E11).
- Szkic zapisywany w telefonie przed „Zapisz wpis” (z makiety „Szkic zapisany w telefonie”) i „ostatnio otwierane zlecenia” w wyborze (decyzja Konrada 2026-11-13, pytanie 3 niżej).
- Własne dyktowanie (dyktowanie systemowe z klawiatury działa bez kodu).

## Decyzje i ograniczenia
- UX / UI: układ elementu „Wymaga uwagi” — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-07). Formularz M-04: AppBar z SyncIndicator, chipy kategorii (FilterChip, wybór pojedynczy, grupa radio „Kategoria”), etap jako wybór z listy etapów zlecenia, pole treści (TextArea), „Zapisz wpis” w dolnym pasku; stany: pusty (brak zleceń do wyboru), błąd walidacji (AC3), brak miejsca w telefonie („Brak miejsca w telefonie. Zwolnij miejsce — wpis zostaje w formularzu.”), offline (normalna praca), brak uprawnień / ukryte dane (AC4); cele dotyku ≥ 48 dp.
- Uprawnienia: Administrator i Edytor zapisują; Tylko odczyt nie loguje się do aplikacji (decyzja Konrada 2026-11-12); niezalogowany — logowanie. Telefon tylko dodaje (popraw/usuń/zredaguj tylko w panelu).
- Bezpieczeństwo i prywatność: treść wpisu to potencjalnie dane osobowe — trafia wyłącznie do kolejki w bazie SQLCipher (EVM-093), nie do logów, parametrów nawigacji, stanu odtwarzanego po śmierci procesu ani diagnostyki. Klawiatura: autouzupełnianie (autofill) wyłączone; autokorekta i sprawdzanie pisowni w polu treści pozostają włączone dla wygody pisania długiego tekstu i dyktowania (decyzja Konrada 2026-11-13, pytanie 2; w polach nazwy, adresu i telefonu wyłączone — EVM-106). Ryzyko rezydualne (słownik klawiatury poza katalogiem aplikacji) jak w EVM-103.
- Czas zapisu (`capturedAt`) jest tylko informacją; kolejność w dzienniku biura wg czasu serwera.

## Notatki
- Domyślna kategoria „Inne” zamiast „ostatnio użytej” (brak trwałego zapisu preferencji — YAGNI).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację UX (product-owner)
- 2026-11-13 — refinement do DoR: 6 AC (dodano wejścia i cel, ukryte dane, zlecenia zamknięte; usunięto szkic i „ostatnio otwierane” — YAGNI), rozgraniczenie z EVM-104/107, pytania 2–3 do Konrada z rekomendacją; status `draft` do akceptacji (product-owner)
- 2026-11-13 — akceptacja Konrada (DoR) do nocnej kolejki `/noc-2026-11-13`: kolejność toru A 104 → 105 → 127 → 106 (tor B: 126 → 066), autokorekta zostaje w długich tekstach (wyłączona w polach klienta, telefonu, adresu; autofill wszędzie wyłączony), bez szkiców i „ostatnio otwieranych” w M2, EVM-126 — budowa panelu bez adresu kończy się błędem; status `ready` (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-13` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-13-mobile`
