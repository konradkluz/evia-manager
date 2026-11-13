# Runbook: kolejka e-maili — skrzynka nadawcza, przekaźnik i zadanie `email.send`

> Dokument żywy (EVM-024). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem do serwera) i deweloper lokalnie. Wymagania: SR-AUTH-12, SR-ERR-02, SR-LOG-02, SR-LOG-03, SR-API-13, SR-DATA-01; ADR-0010; polityki P1, P2. Wysyłka na staging przez Scaleway TEM (EVM-089): transport `tem`, strażnik odbiorców, SPF / DKIM / DMARC — sekcje „Scaleway TEM” i „Rekordy DNS” poniżej; kolejność wdrożenia: `posiedzenie-adres-panelu-i-email.md`.

E-mail transakcyjny przechodzi **jedną drogą**: transakcja zmiany zapisuje wiersz skrzynki nadawczej → przekaźnik workera przekazuje wiersz do kolejki → zadanie `email.send` tworzy treść i wysyła przez port `EmailSender`. API nie uruchamia kolejki — tylko zapisuje wiersz. Ładunek zadania to **sam identyfikator wiersza**; adres odbiorcy, nazwa, token i treść nie trafiają do skrzynki, kolejki ani logów.

## Jak to działa
| Element | Gdzie | Co robi |
|---|---|---|
| Skrzynka nadawcza | tabela `platform.email_outbox` (migracja `0035`) | wiersz na wiadomość: rodzaj (`user_invitation`, `administrator_alert`, od EVM-025 `password_reset` i `password_changed` — migracja `0037`), identyfikator odbiorcy, stan (`pending` → `sent` / `failed` / `superseded`), liczba prób, czasy; rola aplikacji bez `DELETE` |
| Przekaźnik | worker, co 5 s | bierze wiersze `pending` bez przekazania (albo przekazane ponad 20 minut temu), wysyła zadanie `email.send` z `id` = `id` wiersza, dopiero potem oznacza `enqueued_at`; `FOR UPDATE SKIP LOCKED` |
| Zadanie `email.send` | worker, kolejka pg-boss | blokuje konto, potem wiersz; sprawdza, że wiersz jest `pending` i konto nadal czeka na aktywację; tworzy token (w bazie tylko skrót, ważność 72 h od wysłania), unieważnia poprzednie linki tego konta; **po zatwierdzeniu transakcji** wysyła wiadomość; zapisuje wynik |
| Port i transport | `EMAIL_TRANSPORT` | `smtp` → Mailpit (dev); `tem` → Scaleway Transactional Email przez HTTPS (staging i produkcja, zawsze za strażnikiem odbiorców); `none` → nic nie jest wysyłane |

**Ponowienia (AC5):** przerwy około 30, 60, 120, 240 i 480 s (z losowym rozrzutem). Błąd przejściowy (brak połączenia, limit czasu, 429, 5xx, a przy TEM także 401 / 403 — zły klucz) zwiększa `attempts` i ponawia zadanie; **po 5. nieudanej próbie wiersz dostaje stan `failed`, a zadanie kończy się bez błędu**. Błąd trwały (odrzucony odbiorca albo wiadomość — TEM 400 / 422) daje `failed` od razu. W panelu (W-16) `failed` to „Nie wysłano” z akcją „Wyślij ponownie” — konto zostaje `invited`, nic nie jest tracone.

**Duplikat wiadomości (świadomie):** gdy wiadomość wyszła, a zapis stanu `sent` się nie powiódł (awaria procesu), zadanie powtórzy wysyłkę z **nowszym** tokenem — odbiorca może dostać dwie wiadomości, ale działa tylko ten nowszy link (poprzedni jest unieważniony). To dostarczanie „co najmniej raz”.

**Reset hasła (EVM-025):** rodzaj `password_reset` — zadanie tworzy token linku przy wysyłce (w bazie tylko skrót w `identity.one_time_links`, `purpose = password_reset`, ważność 30 minut od wysyłki), poprzednie otwarte linki resetu tego konta kończy w tej samej transakcji; wiersz starszy niż 30 minut (worker nie działał), konto nieaktywne, usunięte albo bez klucza dostępu jest `superseded` bez tokenu i bez wysyłki. Rodzaj `password_changed` — powiadomienie „Hasło zostało zmienione”, zapisywane w transakcji resetu (wycofanie resetu = brak wiadomości). Prośby o link są ograniczone do jednej na minutę i pięciu na godzinę na konto (liczone z tej tabeli, cichy brak wiersza). Surowy token nigdy nie trafia do wiersza, zadania ani logu.

## Stany i co z nimi zrobić
| Stan wiersza | Znaczenie | Działanie |
|---|---|---|
| `pending`, `enqueued_at` pusty | czeka na przekaźnik (worker nie działa albo transport `none`) | uruchom workera z `EMAIL_TRANSPORT=smtp` (dev) — wiersze zostaną przekazane, nic nie zginęło |
| `pending`, ponawiane | usługa e-mail nie odpowiada | poczekaj na kolejne próby; sprawdź log workera (`email: attempt failed; will retry`, pola `outboxId`, `kind`, `code`) |
| `failed` | próby wyczerpane albo odbiorca odrzucony | log workera `email: not sent` (`outboxId`, `kind`, `code`); gdy usługa wróciła — Administrator wybiera „Wyślij ponownie” w W-16 (powstaje nowy wiersz; stary zostaje jako historia) |
| `superseded` | zastąpiony nowszym zaproszeniem albo konto nie wymaga już wiadomości (aktywne, dezaktywowane, usunięte) | brak — wiadomość się nie wysyła i nie powstaje token |
| `sent` | wiadomość przekazana do transportu | — |

Kody błędów w logu (stałe, bez treści sterownika): przejściowe `connection_failed`, `timeout`, `temporary_refusal`, `send_failed`; trwałe `recipient_rejected`, `message_rejected`, `invalid_message`, `misconfigured`. Od EVM-089 TEM dodaje przejściowy `provider_auth` (TEM odpowiedział 401 / 403: **klucz jest zły, wygasł albo został odwołany** — po 5 próbach wiersz jest `failed`; rotacja klucza: sekcja „Scaleway TEM”). Adres przechwycony przez strażnika nie jest błędem: log `email: intercepted` (pola `outboxId`, `kind`, `reason`) i wiersz `sent`.

## Konfiguracja i zdrowie workera
- `EMAIL_TRANSPORT` jest **wymagane**, bez wartości domyślnej — brak to błąd startu workera (komunikat wymienia tylko nazwę klucza). `smtp` wymaga `EMAIL_SMTP_HOST` (tylko `mailpit`, `localhost`, `127.0.0.1`, `::1`), `EMAIL_SMTP_PORT` i `EMAIL_FROM`; **`smtp` jest odrzucane przy `NODE_ENV=production`** (także przy braku `NODE_ENV`, czyli na stagingu i produkcji). Serwer API tych kluczy nie czyta.
- `tem` (EVM-089) — patrz „Scaleway TEM” poniżej; dozwolone także przy `NODE_ENV=production`.
- `none` — worker nie rejestruje zadania ani przekaźnika, w logu przy starcie jest błąd (`worker: the e-mail transport is none …`), a **healthcheck kontenera jest czerwony**. Wiersze zostają w skrzynce jako `pending` (zadania nie mogą czekać w pg-boss: biblioteka usuwa zadanie niewykonane po retencji 7 dni).
- Healthcheck: `node dist/src/cli/worker-health.js` czyta plik `/tmp/worker-health` (czas i rodzaj transportu, nic więcej; worker zapisuje go co 30 s). Kod 1 gdy plik jest starszy niż 2 minuty, brakuje go albo transport to `none`. Publiczny `/api/health` się nie zmienia.
- Ustawienia kolejki `email.send` (pięć ponowień, pierwsza przerwa 30 s, wykładniczo do 480 s, własna kolejka martwych zadań) worker stosuje przy każdym starcie także do kolejki, która już istnieje.

## Lokalnie: Mailpit
`pnpm run dev` uruchamia usługę `mailpit` (`compose.dev.yaml`): SMTP `127.0.0.1:1025`, interfejs `http://127.0.0.1:8025` — **tylko pętla zwrotna**, wiadomości w pamięci kontenera, **bez przekazywania na zewnątrz** (brak `MP_SMTP_RELAY_*`). Zaproszenie z W-16 pojawia się w Mailpit po kilku sekundach (przekaźnik odpytuje co 5 s). Dane tylko syntetyczne. Sprawdź ręcznie: polskie znaki w temacie i treści, link `…/activate#<token>` nienaruszony i klikalny (`docs/ux/flows/e-maile.md`, zasada 14).

## Bezpieczeństwo — czego pilnować
- Wiadomość ma jednego odbiorcę, temat i `text/plain`; adres z CR/LF, cudzysłowem, `<>,;` lub dwoma `@` jest odrzucany już przy zaproszeniu (`400 validation_failed`). Logger biblioteki SMTP jest wyłączony (zrzuciłby transkrypt sesji razem z linkiem).
- Dostawca zewnętrzny zawsze za strażnikiem odbiorców (EVM-089; fabryka TEM nie zwraca adaptera bez niego): adres na `example.com`, `example.net`, `example.org` (z subdomenami), `.test`, `.example`, `.invalid`, `.localhost` jest **przechwytywany lokalnie w każdym trybie** — zadanie kończy się bez błędu i bez ponowień, nic nie opuszcza środowiska, log bez adresu i treści.
- Zaproszenia i ponowne wysłania nie mają limitu na Administratora ani odstępu (zaproszenia tworzy wyłącznie Administrator; ryzyko Low, TM-139, do backlogu); przy realnej poczcie obowiązuje próg 300 e-maili miesięcznie (`docs/ops/koszty-staging.md`).
- Retencja wierszy `sent` i `superseded` skrzynki (EVM-089, `docs/security/rodo.md`): jak konta — rola aplikacji nie ma `DELETE`, wiersze zawierają tylko identyfikatory, rodzaj i czasy (bez adresu i treści), bez nowego mechanizmu.
- **Przechwycona wiadomość kończy wiersz jako `sent`**, więc W-16 pokaże „Wysłano”, choć nic nie wyszło (tryb `lista`: adres spoza listy; tryb `otwarty`: tylko domeny zarezerwowane). Rozpoznanie: log `email: intercepted` z `outboxId`.

## Scaleway TEM (EVM-089): konfiguracja, tryby, klucz
Worker na stagingu ma `EMAIL_TRANSPORT=tem` (`infra/runtime/compose.staging.yaml`). Adres API TEM (`api.scaleway.com`, region `fr-par`) to **stała w kodzie** — nie ma zmiennej ani pliku, które go zmieniają; żądanie nie podąża za przekierowaniami, ma limit czasu 5 s, a odpowiedź TEM nie trafia do logu ani błędu. Jedyny ruch wychodzący workera związany z pocztą to HTTPS 443 do TEM (zapora wypuszcza tylko 443/tcp).

| Plik w `/etc/evia/secrets/` (0600 root; w kontenerze workera `/run/secrets/…`) | Zawartość | Uwagi |
|---|---|---|
| `tem-api-key` | klucz API TEM (UUID) — **sekret** | tylko worker (manifest); nigdy w repozytorium, obrazie, logu ani zmiennej środowiska; start workera sprawdza format |
| `tem-project-id` | identyfikator projektu Scaleway (UUID) | tylko worker |
| `email-recipient-mode` | `lista` albo `otwarty` | plik musi istnieć (manifest odmawia startu bez niego); **pusty, nieznany lub błędnie napisany tekst = `lista`** (fail-closed) |
| `email-allowed-recipients` | adres w linii (`#` zaczyna komentarz); plik może być pusty | używana tylko w trybie `lista`; pusta lista = przechwycenie wszystkiego; **niepoprawny wpis zatrzymuje start workera** (w logu tylko nazwa ustawienia) |

**Nadawca:** `EMAIL_FROM=powiadomienia@panel.eviacharge.pl` — domena **dokładnie** równa zweryfikowanej w TEM (`panel.eviacharge.pl`); inna domena zatrzymuje start workera.

**Tryby odbiorców (AC2):** `lista` (domyślny) — wysyłka tylko na adresy z pliku, każdy inny jest przechwytywany; `otwarty` — wysyłka na każdy poprawny adres **poza zarezerwowanymi** (`example.com` itd., `.test`), które są przechwytywane zawsze. Tryb `otwarty` włącza się wyłącznie świadomą zmianą pliku na VM (z Konradem), nigdy w repozytorium.

### Zmiana trybu albo listy
1. Na VM jako root: edytuj plik w `/etc/evia/secrets/` (zachowaj 0600 root), np. `printf 'otwarty\n' > /etc/evia/secrets/email-recipient-mode` (adresów nie wklejaj do czatu ani zgłoszeń).
2. Kopia w `/run/evia/secrets/worker/` odświeża się przy kolejnym wdrożeniu kanału albo po `systemctl restart evia-secrets` (ten sam skrypt co przy starcie systemu); potem **restart workera** — konfiguracja jest czytana tylko przy starcie.
3. Sprawdź log startu workera (bez trybu i listy) i healthcheck kontenera (`tem` = transport zdrowy; healthcheck nie wywołuje TEM).

### Rotacja klucza TEM (SR-INFRA-05)
Klucz należy do **osobnej aplikacji IAM Scaleway** (np. `evia-staging-tem`) z minimalnym zestawem uprawnień TEM (wysyłka e-maili; bez uprawnień do domen, projektów i innych usług) i ograniczoną do projektu środowiska — nie do klucza sesji IaC. Rotacja (co 90 dni i po każdym podejrzeniu wycieku; ogólnie: `docs/ops/rotacja-sekretow.md`):
1. W konsoli Scaleway: IAM → aplikacja → nowy klucz API, z datą wygaśnięcia.
2. Na VM: zapisz nowy klucz do `/etc/evia/secrets/tem-api-key` (0600 root), odśwież kopię (`systemctl restart evia-secrets`) i zrestartuj workera.
3. Wyślij zaproszenie testowe na adres z listy (tryb `lista`) i sprawdź w logu `email: sent` oraz brak `provider_auth`.
4. Dopiero potem odwołaj stary klucz w IAM. Przy podejrzeniu wycieku odwołaj go **najpierw** (wysyłka stanie na `provider_auth`; wiersze wrócą po „Wyślij ponownie”).

Wyciek klucza nie jest widoczny w repozytorium — dlatego `gitleaks` w `pnpm run scan` i w hooku jest obowiązkowy; sam klucz pozwala wysłać phishing z poprawnym DKIM z naszej domeny (TM-138).

### Podgląd kolejki i martwych zadań bez danych osobowych
Na VM wyłącznie przez polecenia infrastruktury; **agent nie wykonuje zapytań na żywej bazie** (RR-93). Konrad używa W-16 (stan „Wysłano” / „Nie wysłano”) albo logu workera (`docker compose logs worker`; pola `outboxId`, `kind`, `code`, bez adresów). Liczby: wierszy skrzynki według stanu (`select state, count(*) from platform.email_outbox group by state`) i martwych zadań (`select count(*) from pgboss.job where name = 'email.send.dead-letter'`) Konrad wykonuje w `psql` sam, bez kolumn z identyfikatorami odbiorców. Ponowienie: Administrator wybiera „Wyślij ponownie” w W-16 (powstaje nowy wiersz).

### Stare wiersze `pending` przed włączeniem wysyłki (TM-80)
Token zaproszenia powstaje dopiero w chwili wysyłki. Zaproszenie zalegające tygodniami przy `EMAIL_TRANSPORT=none` dostałoby po włączeniu TEM **świeży, ważny 72 godziny link** — dla osoby, która może już nie powinna go dostać.
1. **Przed wdrożeniem** Konrad przegląda W-16 i ocenia wszystkie „oczekujące” zaproszenia (czy są nadal potrzebne).
2. Przy starcie z transportem `tem` worker, **zanim zarejestruje przekaźnik i zadanie**, oznacza jako `failed` wszystkie wiersze `pending` starsze niż `EMAIL_PENDING_MAX_AGE_HOURS` (domyślnie 24; oba rodzaje: `user_invitation` i `administrator_alert`); w logu tylko liczba (`worker: stale pending e-mails expired`). Wiersz zostaje w W-16 jako „Nie wysłano” — Administrator może wysłać ponownie świadomie.
3. Zadanie, które było już w kolejce dla takiego wiersza, nie wysyła wiadomości i nie tworzy tokenu (zadanie pomija wiersze inne niż `pending`).

## Rekordy DNS nadawcy (AC3; SR-INFRA-12)
Wartości **pochodzą z `tofu output tem_panel_dns`** (sesja IaC — nigdy z pamięci ani z tego dokumentu; klucz DKIM tworzy Scaleway). Konrad dodaje je **raz** w OVH dla `panel.eviacharge.pl`:

| Rekord | Nazwa | Wartość | Uwagi |
|---|---|---|---|
| SPF (TXT) | `panel.eviacharge.pl` | `spf_value` z `tofu output` (zawiera `include:` TEM), zakończony `-all` | jeden rekord SPF na nazwę; nie dodawaj drugiego |
| DKIM (TXT) | `dkim_name` z `tofu output` | `dkim_config` z `tofu output` | wyłącznie z outputu |
| DMARC (TXT) | `_dmarc.panel.eviacharge.pl` | najpierw `v=DMARC1; p=none; rua=mailto:<ALIAS>` | `<ALIAS>` to alias w skrzynce Konrada na raporty i odbicia (adres podaje Konrad w posiedzeniu; **nie trafia do repozytorium**) |
| DMARC po sprawdzeniu nagłówków | j.w. | `v=DMARC1; p=reject; sp=reject; rua=mailto:<ALIAS>` | **natychmiast po potwierdzeniu `pass`** (bez czekania na raporty); wystarczy zgodność DKIM — nie wymagaj `aspf=s` |

Kolejność (AC3): rekordy SPF i DKIM → weryfikacja domeny w konsoli TEM → DMARC `p=none` → wiadomość testowa na adres Konrada (tryb `lista`) → w nagłówkach `Authentication-Results`: `spf=pass`, `dkim=pass`, `dmarc=pass` → `p=reject` → **dopiero wtedy** pierwsza wysyłka na realny adres (tryb `otwarty`). Sprawdzenie DNS: `nslookup -type=TXT panel.eviacharge.pl`, `nslookup -type=TXT _dmarc.panel.eviacharge.pl`, `nslookup -type=TXT <dkim_name>`; `node tools/staging-verify/cli.mjs checks` czyta SPF, DMARC i CAA panelu (profil `staging`: brak `rua` i CAA to ostrzeżenia).

### Sprzątanie starej domeny TEM `staging.eviacharge.pl`
Stara domena zostaje w OpenTofu (`module "tem"`) do chwili, gdy wysyłka z `panel.eviacharge.pl` jest stabilna (co najmniej tydzień bez `failed`). Wtedy: usuń `module "tem"` z `infra/tofu/staging/main.tf` (PR, `tofu plan` do przeglądu przed `apply`); w OVH dla `staging.eviacharge.pl` ustaw `v=spf1 -all` i DMARC `p=reject` (nieużywana subdomena nie może być podszyta) i usuń stare rekordy DKIM / SPF z TEM.

## Checklista „wykonano na środowisku” (AC5)
Wypełnia Tech Lead z Konradem w posiedzeniu (`posiedzenie-adres-panelu-i-email.md`); każda pozycja z datą i inicjałami, bez adresów i kluczy.
- [ ] podgląd kolejki i martwych zadań (W-16 i log workera)
- [ ] ponowienie („Wyślij ponownie”)
- [ ] rotacja klucza TEM
- [ ] zmiana trybu `lista` → `otwarty` (plik + restart workera)
- [ ] sprawdzenie DNS (SPF, DKIM, DMARC) i nagłówków wiadomości testowej
