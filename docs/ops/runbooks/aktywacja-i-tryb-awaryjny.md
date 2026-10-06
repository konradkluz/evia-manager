# Runbook: aktywacja pierwszego Administratora i tryb awaryjny

> Dokument żywy (EVM-016). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem SSH do serwera). Wymagania: SR-AUTH-12 (bootstrap), RR-16 (tryb awaryjny), SR-LOG-02, SR-LOG-07; polityki P1, P9.

## Kiedy użyć
| Sytuacja | Polecenie | Skutek |
|---|---|---|
| Nowy system, nie ma żadnego aktywnego Administratora | `node dist/src/cli/bootstrap-admin.js` | konto „Oczekuje na aktywację” (`invited`, rola Administrator) i jednorazowy link ważny 72 godziny |
| Zgubiony telefon / klucz dostępu, zapomniane hasło, podejrzenie przejęcia konta Administratora (do czasu kodów odzyskiwania z EVM-023 to jedyna droga) | `node dist/src/cli/bootstrap-admin.js --emergency --reason <powód>` | konto wraca do „wymaga aktywacji”, kończą się wszystkie jego sesje, powstaje alert bezpieczeństwa; nowy link 72 h |
| Aktywny Administrator istnieje, a polecenie uruchomiono bez `--emergency` | — | odmowa, baza bez zmian |

Powody (`--reason`, zamknięta lista; nie ma wolnego tekstu — dziennik audytu jest nieusuwalny): `lost_device`, `lost_credentials`, `suspected_compromise`, `other`.

## Jak uruchomić
1. Połącz się z serwerem przez SSH i uruchom polecenie **wyłącznie przez `docker exec -it`**:
   ```
   docker exec -it <kontener-api> node dist/src/cli/bootstrap-admin.js
   docker exec -it <kontener-api> node dist/src/cli/bootstrap-admin.js --emergency --reason lost_device
   ```
   Nie używaj `docker run` ani `docker compose run`: wyjście jednorazowego kontenera trafia do `docker logs`, a stamtąd do kolektora logów (Alloy) — link wyciekłby do logów. Polecenie samo odmawia, gdy nie ma terminala interaktywnego na wejściu i wyjściu, gdy jest głównym procesem kontenera (`pid 1`) albo jego bezpośrednim potomkiem (`ppid 1`) i nie łączy się wtedy z bazą.
2. **Adres e-mail wpisujesz w terminalu**, na pytanie polecenia — nie w argumentach (argumenty widać w `ps` i w historii powłoki). Polecenie nie przyjmuje hasła ani tokenu w żadnej formie (`--password…` jest odrzucane) i nie wysyła e-maili.
3. Tryb awaryjny prosi o **ponowne wpisanie adresu** konta jako potwierdzenie. Odmowy nie ujawniają, czy adres istnieje: nieznany adres, inna rola, konto nieaktywne i brak aktywnego Administratora dają ten sam komunikat.
4. Polecenie wypisuje link `https://<panel>/activate#<token>` — tylko na terminalu. Adres panelu pochodzi z konfiguracji (`PANEL_ORIGIN`), nigdy z nagłówków. Link jest ważny 72 godziny (zegar rzeczywisty, nie „3 dni kalendarzowe” — przy zmianie czasu 25.10.2026 nie wydłuża się ani nie skraca).

## Co dalej (W-13 → W-03)
1. Otwórz link w przeglądarce **na swoim komputerze**. Strona usuwa token z paska adresu i z historii zaraz po wczytaniu; samo otwarcie nie zużywa linku (skaner linków w poczcie go nie „spali”).
2. Ustaw hasło (min. 15 znaków, dowolne znaki Unicode, wklejanie dozwolone; odrzucane są hasła popularne, ze słowami kontekstowymi „evia”, „charge” itp. i z wycieków — sprawdzenie w Pwned Passwords wyłącznie k-anonimowo; przy niedostępności usługi sprawdzenie lokalne i aktywacja jest możliwa).
3. Zarejestruj klucz dostępu (passkey) — jedyna metoda dla Administratora. Dopiero rejestracja klucza aktywuje konto, zużywa link i otwiera pełną sesję.
4. **Wyczyść ekran terminala** (`clear`) i nie wklejaj linku do czatu, zgłoszeń ani poczty. Link zostaje w przewijanej historii terminala (ryzyko rezydualne R4).

## Skutki trybu awaryjnego (w jednej transakcji)
- hasło i klucze dostępu konta są **usuwane** (nie tylko oznaczone), konto ma status `invited`;
- wszystkie sesje konta kończą się — stare ciasteczko daje `401 session_revoked`; kończą się też sesje i wyzwania zbudowane na wcześniej wydanych linkach;
- wszystkie niewykorzystane linki aktywacyjne (także innych kont) tracą ważność, powstaje jeden nowy;
- zdarzenia w dzienniku audytu (bez adresu e-mail): `account.emergency_reset` z powodem, `session.revoked`, `activation_link.issued`;
- **alert bezpieczeństwa** (SR-LOG-07): trwały rekord w `platform.security_alert_outbox`, zapisany w tej samej transakcji. Proces API emituje go co 15 sekund do swoich logów jako wpis `error` z polami `alert: "security"`, `alertCode: "emergency_reset"` (reguła alertu EVM-007 dopasowuje po tych polach) i oznacza jako wyemitowany. Polecenie nie alarmuje przez własne logi, bo jego wyjście nie trafia do kolektora.

## Bezpieczeństwo — czego nie robić
- Nie uruchamiaj polecenia przez `docker run` / `docker compose run` / cron / skrypt bez terminala (odmowa, a jeśli kiedyś ominięta — link w logach).
- Nie przekazuj adresu, hasła ani tokenu w argumentach lub zmiennych środowiskowych.
- Nie zapisuj linku w plikach, notatkach, komunikatorach ani zgłoszeniach; po użyciu wyczyść ekran. Link jest jednorazowy, ale do czasu użycia daje przejęcie konta.
- Podejrzewasz, że link wyciekł: uruchom polecenie ponownie — nowy link unieważnia wszystkie poprzednie oraz sesje, które na nich zbudowano.
- Odmowa polecenia nie zostawia śladu w dzienniku audytu aplikacji (ryzyko rezydualne R3) — rozliczalność zapewniają logi SSH hosta.

## Wymagania dla środowiska (do EVM-007 i EVM-076)
- API łączy się z bazą rolą `evia_app` (członek roli `evia_app`, bez własności obiektów) — inaczej ochrona dziennika audytu nie działa; migracje uruchamia osobna tożsamość (`evia_migrator`).
- Zmienne: `PANEL_ORIGIN` (https, bez `localhost` na produkcji), `WEBAUTHN_RP_ID` (host panelu albo domena nadrzędna), `WEBAUTHN_RP_NAME`, opcjonalnie `TRUSTED_PROXIES` (adresy reverse proxy, domyślnie pusta lista — nagłówek `X-Forwarded-For` jest wtedy ignorowany); wzór: `.env.example`.
- Alloy zbiera logi wyłącznie z kontenerów usług z listy dozwolonych (nie z kontenerów jednorazowych); smoke na stagingu: tokenu nie ma w Alloy.
- Caddy: bez `log_credentials`, z filtrem nagłówka `X-CSRF-Token` w logach dostępu; Sentry: `sendDefaultPii=false`, bez treści żądań `/api/v1/auth/activation/*`, `beforeSend` i `beforeBreadcrumb` czyszczą fragment adresu oraz pola `token`, `password`, `csrf`.
- Do wydania produkcyjnego: zadanie czyszczące (retencja sesji z pełnym IP 30 dni, wyzwań WebAuthn i linków jednorazowych) — dług z ID w historyjce EVM-016.

## Rozwiązywanie problemów
| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| „Polecenie wymaga terminala interaktywnego” | brak `-it` albo wyjście przekierowane | uruchom przez `docker exec -it` |
| „nie może być głównym procesem kontenera” | `docker run` / `docker compose run` | użyj `docker exec -it <kontener-api> …` |
| „Odmowa: w systemie jest już aktywny Administrator” | konto już aktywowane | tryb awaryjny z powodem |
| „Odmowa: nie można wydać linku dla tego adresu” | adres nie należy do aktywnego Administratora albo jest nieaktywnym kontem | sprawdź adres; konto nieaktywne reaktywuje EVM-027 |
| W panelu „Link jest nieważny lub wygasł.” | link użyty, zastąpiony nowszym, wygasły lub zmieniony | wydaj nowy link poleceniem |
