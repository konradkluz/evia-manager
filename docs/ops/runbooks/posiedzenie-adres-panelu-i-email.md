# Runbook: posiedzenie — adres panelu `panel.eviacharge.pl` i e-mail przez Scaleway TEM

> Dokument żywy (EVM-089). Właściciel: `devops-engineer`; przegląd: `security-engineer`. Wykonuje Tech Lead razem z Konradem (posiedzenie po scaleniu zmian z EVM-089). Wymagania: SR-INFRA-05, SR-INFRA-12, SR-AUTH-09, SR-WEB-02, SR-API-13; ADR-0011, ADR-0018; RR-41, RR-93. Szczegóły kolejki, trybów i rekordów DNS: [`kolejka-e-mail.md`](kolejka-e-mail.md).

**Zasady posiedzenia (RR-93):** obecny staging jest **jedynym środowiskiem z prawdziwymi danymi**. Agenci nie logują się na `panel.eviacharge.pl` ani `staging.eviacharge.pl`, nie czytają bazy, logów ani skrzynek; wszystkie kroki poniżej wykonuje Konrad (albo Tech Lead na jego oczach, poleceniami infrastruktury). Klucze, linki i adresy **nie trafiają do czatu, repozytorium ani zgłoszeń**. Stan wyjściowy: DNS `A` / `AAAA` / `CAA` (`0 issue "letsencrypt.org"`) dla `panel.eviacharge.pl` Konrad już dodał.

Skutki zmiany adresu, o których trzeba wiedzieć z góry: (a) zmienia się RP ID WebAuthn — **dotychczasowy klucz dostępu (passkey) Konrada przestaje działać** i trzeba go zarejestrować ponownie; (b) ciasteczka `__Host-` są przypięte do hosta, więc sesje na starym adresie się kończą, a Konrad dostanie alert „nowa przeglądarka” (oczekiwany); (c) `staging.eviacharge.pl` tylko przekierowuje (308) na panel i **nie obsługuje już API**; (d) aplikacja mobilna musi dostać nowy adres API.

## Kolejność
Pliki sekretów i rekordy DNS muszą istnieć **przed** wdrożeniem workera z `tem` (manifest odmawia startu bez plików, kanał cofa wdrożenie).

### 1. Przed scaleniem — OpenTofu (sesja IaC, `compose.iac.yaml`)
1. W `staging.tfvars` (poza repozytorium) Konrad zmienia `panel_origin` na `https://panel.eviacharge.pl` (jedna wartość, bez gwiazdki i bez starego hosta: CORS bucketu mediów).
2. `plan` do przeglądu (nowe: domena TEM `panel.eviacharge.pl`; zmiana: CORS bucketu mediów; **stara domena TEM zostaje**) → `apply` po akceptacji Konrada. Koszt: 0 zł (próg 300 e-maili miesięcznie, `docs/ops/koszty-staging.md`).
3. `output tem_panel_dns` — z niego pochodzą wartości do OVH (krok 2).

### 2. OVH — rekordy nadawcy (Konrad, jednorazowo)
Tabela rekordów i ich kolejność: [`kolejka-e-mail.md`](kolejka-e-mail.md) → „Rekordy DNS nadawcy”. Skrót: SPF (`-all`) i DKIM z `tofu output`; DMARC `p=none; rua=mailto:<ALIAS>`, gdzie `<ALIAS>` to alias w skrzynce Konrada (adres podaje Konrad **tylko w OVH**, nie w repozytorium). W konsoli TEM sprawdź status domeny (zweryfikowana).

### 3. Na VM — pliki sekretów (przed wdrożeniem)
1. Konsola Scaleway → IAM: **osobna aplikacja** `evia-staging-tem` z minimalnym zestawem uprawnień TEM, ograniczona do projektu środowiska; nowy klucz API z datą wygaśnięcia ([`kolejka-e-mail.md`](kolejka-e-mail.md) → „Rotacja klucza TEM”).
2. Jako root w `/etc/evia/secrets/` (0600 root, katalog 0700), bez wklejania wartości do czatu: `tem-api-key` (klucz), `tem-project-id` (identyfikator projektu), `email-recipient-mode` z tekstem `lista`, `email-allowed-recipients` z **jednym** adresem Konrada. Sprawdzenie bez wartości: `evia-init-secrets --check` (rozmiar, tryb, właściciel; brak = `MISSING`).
3. Przejrzyj W-16 **przed** wdrożeniem: zaległe „oczekujące” zaproszenia (przy `EMAIL_TRANSPORT=none` nigdy nie wyszły). Worker i tak oznaczy `pending` starsze niż 24 h jako `failed` przy starcie z `tem`, ale decyzja, kto ma dostać zaproszenie, należy do Administratora.

### 4. Scalenie i wdrożenie kanałem
Konrad scala PR EVM-089 (D2). Kanał wdraża: Caddy dostaje blok `panel.eviacharge.pl` (certyfikat Let's Encrypt wystawia po pierwszym żądaniu; DNS jest gotowy) i przekierowanie `staging.eviacharge.pl` → panel; API i worker startują z `PANEL_ORIGIN` / `WEBAUTHN_RP_ID` = panel; worker wygasza stare `pending` przed przekaźnikiem. W razie błędu: [`rollback-staging.md`](rollback-staging.md) (plik z listą sekretów workera zostaje — nie przeszkadza w rollbacku).
Sprawdź: `curl -sI https://panel.eviacharge.pl/version`, `curl -sI https://staging.eviacharge.pl/` (308, `Location` = stały adres panelu, HSTS), `node tools/staging-verify/cli.mjs checks` (nie loguje się, czyta tylko nagłówki i DNS).

### 5. Wiadomość testowa i nagłówki (AC3)
W trybie `lista` z adresem Konrada: poproś o reset hasła **dla własnego konta** albo zaproś własny drugi adres. W źródle wiadomości sprawdź `Authentication-Results`: `spf=pass`, `dkim=pass`, `dmarc=pass`. Zgodność DKIM wystarcza (nie wymagaj `aspf=s`). Gdy któryś wynik nie jest `pass` — nie zmieniaj DMARC; diagnoza wg dokumentacji TEM i `tofu output`.
Po `pass`: DMARC → `v=DMARC1; p=reject; sp=reject; rua=mailto:<ALIAS>` **natychmiast** (bez czekania na raporty). Pierwsza wysyłka na adres realnego użytkownika dopiero po tym kroku (RR-41 domknięte przez `rua`).

### 6. Passkey Konrada na nowym RP ID
1. Konrad przez SSH (poza czatem): `docker exec -it <kontener-api> /nodejs/bin/node dist/src/cli/bootstrap-admin.js --emergency --reason other` ([`aktywacja-i-tryb-awaryjny.md`](aktywacja-i-tryb-awaryjny.md)). **Wynik (link) nie trafia do agenta, czatu ani repozytorium** — Konrad otwiera go sam w przeglądarce.
2. Rejestracja nowego klucza dostępu na `https://panel.eviacharge.pl`; potem odwołaj w Koncie stare klucze z RP ID staging (nie działają, ale to martwe poświadczenia).
3. Alert „nowa przeglądarka” jest oczekiwany (ciasteczka `__Host-` przypięte do hosta).

### 7. Tryb `otwarty` i pierwsze zaproszenie
Dopiero po kroku 5 (`p=reject`) i 6: zmiana `email-recipient-mode` na `otwarty` ([`kolejka-e-mail.md`](kolejka-e-mail.md) → „Zmiana trybu albo listy”; restart workera). Zaproszenie biura; adres `.test` i `example.com` nadal są przechwytywane. W W-16 stan „Wysłano”, kolejka martwych zadań pusta (AC6).

### 8. Aplikacja mobilna
Zmienna repozytorium `EVIA_API_BASE_URL` (Settings → Secrets and variables → Actions → Variables) musi wskazywać `https://panel.eviacharge.pl` — Konrad ją zmienia i przebudowuje APK ([`../dystrybucja-apk-android.md`](../dystrybucja-apk-android.md)). Stary adres tylko przekierowuje (klient HTTP może zgubić nagłówek `Authorization` albo zmienić metodę), więc **bez proxy API na starym hoście** — stare APK trzeba zaktualizować.

### 9. Sprzątanie
Stara domena TEM i rekordy `staging.eviacharge.pl` (`v=spf1 -all`, DMARC `p=reject`): [`kolejka-e-mail.md`](kolejka-e-mail.md) → „Sprzątanie starej domeny TEM”, po tygodniu stabilnej wysyłki.

## Dziennik wykonania (wypełnia Tech Lead z Konradem; bez adresów i kluczy)
| Krok | Data | Wynik |
|---|---|---|
| 1 OpenTofu (`panel_origin`, `tem_panel`) | | |
| 2 OVH: SPF, DKIM, DMARC `p=none` | | |
| 3 Pliki sekretów, przegląd W-16 | | |
| 4 Wdrożenie, przekierowanie 308, certyfikat | | |
| 5 Nagłówki `pass`, DMARC `p=reject` | | |
| 6 Passkey na nowym RP ID | | |
| 7 Tryb `otwarty`, zaproszenie biura | | |
| 8 `EVIA_API_BASE_URL` i nowy APK | | |
