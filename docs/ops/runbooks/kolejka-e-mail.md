# Runbook: kolejka e-maili — skrzynka nadawcza, przekaźnik i zadanie `email.send`

> Dokument żywy (EVM-024). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem do serwera) i deweloper lokalnie. Wymagania: SR-AUTH-12, SR-ERR-02, SR-LOG-02, SR-LOG-03, SR-API-13, SR-DATA-01; ADR-0010; polityki P1, P2. Wysyłka na staging (dostawca, lista dozwolonych adresów, SPF / DKIM / DMARC) — EVM-089.

E-mail transakcyjny przechodzi **jedną drogą**: transakcja zmiany zapisuje wiersz skrzynki nadawczej → przekaźnik workera przekazuje wiersz do kolejki → zadanie `email.send` tworzy treść i wysyła przez port `EmailSender`. API nie uruchamia kolejki — tylko zapisuje wiersz. Ładunek zadania to **sam identyfikator wiersza**; adres odbiorcy, nazwa, token i treść nie trafiają do skrzynki, kolejki ani logów.

## Jak to działa
| Element | Gdzie | Co robi |
|---|---|---|
| Skrzynka nadawcza | tabela `platform.email_outbox` (migracja `0035`) | wiersz na wiadomość: rodzaj (`user_invitation`, `administrator_alert`), identyfikator odbiorcy, stan (`pending` → `sent` / `failed` / `superseded`), liczba prób, czasy; rola aplikacji bez `DELETE` |
| Przekaźnik | worker, co 5 s | bierze wiersze `pending` bez przekazania (albo przekazane ponad 20 minut temu), wysyła zadanie `email.send` z `id` = `id` wiersza, dopiero potem oznacza `enqueued_at`; `FOR UPDATE SKIP LOCKED` |
| Zadanie `email.send` | worker, kolejka pg-boss | blokuje konto, potem wiersz; sprawdza, że wiersz jest `pending` i konto nadal czeka na aktywację; tworzy token (w bazie tylko skrót, ważność 72 h od wysłania), unieważnia poprzednie linki tego konta; **po zatwierdzeniu transakcji** wysyła wiadomość; zapisuje wynik |
| Port i transport | `EMAIL_TRANSPORT` | `smtp` → Mailpit (dev); `none` → nic nie jest wysyłane |

**Ponowienia (AC5):** przerwy około 30, 60, 120, 240 i 480 s (z losowym rozrzutem). Błąd przejściowy (brak połączenia, limit czasu, odpowiedź 4xx) zwiększa `attempts` i ponawia zadanie; **po 5. nieudanej próbie wiersz dostaje stan `failed`, a zadanie kończy się bez błędu**. Błąd trwały (odrzucony odbiorca, odpowiedź 5xx) daje `failed` od razu. W panelu (W-16) `failed` to „Nie wysłano” z akcją „Wyślij ponownie” — konto zostaje `invited`, nic nie jest tracone.

**Duplikat wiadomości (świadomie):** gdy wiadomość wyszła, a zapis stanu `sent` się nie powiódł (awaria procesu), zadanie powtórzy wysyłkę z **nowszym** tokenem — odbiorca może dostać dwie wiadomości, ale działa tylko ten nowszy link (poprzedni jest unieważniony). To dostarczanie „co najmniej raz”.

## Stany i co z nimi zrobić
| Stan wiersza | Znaczenie | Działanie |
|---|---|---|
| `pending`, `enqueued_at` pusty | czeka na przekaźnik (worker nie działa albo transport `none`) | uruchom workera z `EMAIL_TRANSPORT=smtp` (dev) — wiersze zostaną przekazane, nic nie zginęło |
| `pending`, ponawiane | usługa e-mail nie odpowiada | poczekaj na kolejne próby; sprawdź log workera (`email: attempt failed; will retry`, pola `outboxId`, `kind`, `code`) |
| `failed` | próby wyczerpane albo odbiorca odrzucony | log workera `email: not sent` (`outboxId`, `kind`, `code`); gdy usługa wróciła — Administrator wybiera „Wyślij ponownie” w W-16 (powstaje nowy wiersz; stary zostaje jako historia) |
| `superseded` | zastąpiony nowszym zaproszeniem albo konto nie wymaga już wiadomości (aktywne, dezaktywowane, usunięte) | brak — wiadomość się nie wysyła i nie powstaje token |
| `sent` | wiadomość przekazana do transportu | — |

Kody błędów w logu (stałe, bez treści sterownika): przejściowe `connection_failed`, `timeout`, `temporary_refusal`, `send_failed`; trwałe `recipient_rejected`, `message_rejected`, `recipient_not_allowed` (domena zarezerwowana — strażnik dostawcy), `invalid_message`, `misconfigured`.

## Konfiguracja i zdrowie workera
- `EMAIL_TRANSPORT` jest **wymagane**, bez wartości domyślnej — brak to błąd startu workera (komunikat wymienia tylko nazwę klucza). `smtp` wymaga `EMAIL_SMTP_HOST` (tylko `mailpit`, `localhost`, `127.0.0.1`, `::1`), `EMAIL_SMTP_PORT` i `EMAIL_FROM`; **`smtp` jest odrzucane przy `NODE_ENV=production`** (także przy braku `NODE_ENV`, czyli na stagingu i produkcji). Serwer API tych kluczy nie czyta.
- `none` — worker nie rejestruje zadania ani przekaźnika, w logu przy starcie jest błąd (`worker: the e-mail transport is none …`), a **healthcheck kontenera jest czerwony**. Wiersze zostają w skrzynce jako `pending` (zadania nie mogą czekać w pg-boss: biblioteka usuwa zadanie niewykonane po retencji 7 dni).
- Healthcheck: `node dist/src/cli/worker-health.js` czyta plik `/tmp/worker-health` (czas i rodzaj transportu, nic więcej; worker zapisuje go co 30 s). Kod 1 gdy plik jest starszy niż 2 minuty, brakuje go albo transport to `none`. Publiczny `/api/health` się nie zmienia.
- Ustawienia kolejki `email.send` (pięć ponowień, pierwsza przerwa 30 s, wykładniczo do 480 s, własna kolejka martwych zadań) worker stosuje przy każdym starcie także do kolejki, która już istnieje.

## Lokalnie: Mailpit
`pnpm run dev` uruchamia usługę `mailpit` (`compose.dev.yaml`): SMTP `127.0.0.1:1025`, interfejs `http://127.0.0.1:8025` — **tylko pętla zwrotna**, wiadomości w pamięci kontenera, **bez przekazywania na zewnątrz** (brak `MP_SMTP_RELAY_*`). Zaproszenie z W-16 pojawia się w Mailpit po kilku sekundach (przekaźnik odpytuje co 5 s). Dane tylko syntetyczne. Sprawdź ręcznie: polskie znaki w temacie i treści, link `…/activate#<token>` nienaruszony i klikalny (`docs/ux/flows/e-maile.md`, zasada 14).

## Bezpieczeństwo — czego pilnować
- Wiadomość ma jednego odbiorcę, temat i `text/plain`; adres z CR/LF, cudzysłowem, `<>,;` lub dwoma `@` jest odrzucany już przy zaproszeniu (`400 validation_failed`). Logger biblioteki SMTP jest wyłączony (zrzuciłby transkrypt sesji razem z linkiem).
- Dostawca zewnętrzny (EVM-089) zawsze za `GuardedEmailSender`: adres na `example.com`, `example.net`, `example.org`, `.test`, `.example`, `.invalid`, `.localhost` jest odrzucany przed wysyłką.
- Zaproszenia i ponowne wysłania nie mają jeszcze limitu na Administratora ani odstępu (poczta idzie tylko do Mailpit); limit i odstęp są wymagane przy realnej poczcie (EVM-089: ochrona przed zalewaniem skrzynek i reputacją nadawcy).
- Retencja wierszy `sent` i `superseded` skrzynki — decyzja w EVM-089 (`docs/security/rodo.md`).
