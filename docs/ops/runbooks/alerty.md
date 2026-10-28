# Runbook: alerty stagingu i rotacja tokenów obserwowalności

> Dokument żywy. EVM-085 AC2, AC5, AC8 (ADR-0013, ADR-0018 „Odstępstwo od ADR-0011”, RR-24). Właściciel: `devops-engineer`; odbiorca alertów: Konrad (e-mail). Powiązane: [restore](restore.md), [wdrożenie stagingu](wdrozenie-staging.md), [rollback](rollback-staging.md), [incydent V0](incydent-blokada-v0.md), [rotacja sekretów kanału](rotacja-sekretow-kanalu.md), [koszty stagingu](../koszty-staging.md). **Stan: reguły i testy gotowe, nieaktywne do sesji IaC**; sekcje „Test” zostaną potwierdzone dowodami w `docs/qa/EVM-085/` po pierwszym wdrożeniu.

## Zasady
- Źródło reguł: `infra/observability/alerts/rules.tmpl.yaml` plus progi w `alerts/thresholds.yaml` (jedyne miejsce progów); `rules.yaml` jest generowany (`node infra/observability/render-rules.mjs`), testy `promtool` w `alerts/tests/`.
- Treść e-maila to nazwa alertu, środowisko, wartość z zamkniętej listy (kod alertu, nazwa tokenu), próg i link do tego dokumentu. Nigdy surowa linia logu.
- **Żadna decyzja wdrożeniowa nie korzysta z danych Grafany** (RR-24): agent tylko zapisuje metryki do pliku, nigdy ich stamtąd nie czyta. Alert nie wstrzymuje ani nie uruchamia wdrożenia.
- Wspólny stos Grafana Free ma limity (patrz [koszty](../koszty-staging.md)); jeden odbiorca, dlatego alertów jest mało i każdy ma znaczenie.

## Ogólna procedura testu (każdy alert)
Test dostarczenia e-maila wykonywany w sesji IaC: na VM staging zapisz do katalogu textfile syntetyczną wartość wywołującą dany warunek (nazwy i wartości z `alerts/tests/rules.test.yaml`), poczekaj na `for:`, sprawdź e-mail, usuń plik, sprawdź powrót do normy. Dowód (zrzut e-maila bez danych osobowych, godziny) do `docs/qa/EVM-085/`. Test logiczny reguł: `docker compose -f compose.yaml run --rm promtool-tests`.

## EviaDeployAgentHeartbeatMissing
- **Znaczenie:** agent wdrożeń nie ukończył udanego cyklu od ponad 600 s (zegar co 90 s). Staging nie przyjmuje nowych wydań.
- **Pierwsza reakcja:** `systemctl status evia-deploy-agent.timer evia-deploy-agent.service`, `journalctl -u evia-deploy-agent -n 100` (dostęp awaryjny: [rollback](rollback-staging.md)); sprawdź `/var/lib/evia/agent/alerts.log`.
- **Eskalacja:** odrzucenie weryfikatora (kod 3) → [incydent V0](incydent-blokada-v0.md); awaria Dockera lub VM → restart usługi, potem plan z [wdrożenia](wdrozenie-staging.md).
- **Test:** zatrzymaj timer na 12 minut w oknie testowym albo wpisz stary znacznik czasu do pliku metryk.

## EviaDeployedCommitBehindMain
- **Znaczenie:** HEAD `main` różni się od wdrożonego commita dłużej niż 1800 s (wydanie nie dochodzi do stagingu).
- **Pierwsza reakcja:** czy CI `main` jest zielone i obraz opublikowany (`publish`)? Dziennik agenta (`journalctl -u evia-deploy-agent`); czy limit API GitHub nie jest wyczerpany (alert niżej).
- **Eskalacja:** czerwone `main` → [github-i-ci](../github-i-ci.md); odrzucone wydanie → V0 lub weryfikator.
- **Test:** wpisz `evia_deploy_agent_main_head_mismatch_since_seconds` większe niż próg.

## EviaDeployBlockedV0
- **Znaczenie:** weryfikator odrzucił wydanie (bramka V0: zmiana na `main` poza zatwierdzonym PR).
- **Pierwsza reakcja:** nie wdrażaj ręcznie. Wykonaj [incydent V0](incydent-blokada-v0.md) (wstrzymanie, analiza, nowa kotwica w sesji IaC).
- **Eskalacja:** podejrzenie przejęcia konta lub repozytorium → rotacja z [rotacja-sekretow](../rotacja-sekretow.md) i [rotacja kanału](rotacja-sekretow-kanalu.md).
- **Test:** wpisz `evia_deploy_agent_v0_blocked 1`.

## EviaTokenExpiresSoon
- **Znaczenie:** PAT albo klucz (nazwa w e-mailu) wygasa za 30 dni lub mniej. Daty pochodzą z `expiries.json` (zapisywanego w sesji IaC; nazwy i daty, bez wartości) oraz z nagłówka wygaśnięcia PAT.
- **Pierwsza reakcja:** rotacja wg [rotacja-sekretow-kanalu](rotacja-sekretow-kanalu.md), tokenu zapisu Grafana lub DSN Sentry wg sekcji niżej; uaktualnij datę w `expiries.json`.
- **Eskalacja:** brak możliwości rotacji przed terminem → rozszerz okno w kalendarzu, nie wydłużaj tokenu ponad 12 miesięcy.
- **Test:** wpisz datę za 29 dni dla fikcyjnej nazwy tokenu.

## EviaGithubApiLimitLow
- **Znaczenie:** pozostało mniej niż 200 zapytań do API GitHub w oknie (budżet agenta, [wdrożenie](wdrozenie-staging.md) „budżet API”).
- **Pierwsza reakcja:** sprawdź, czy agent nie pętli się (`journalctl -u evia-deploy-agent`), czy PAT nie jest używany gdzie indziej.
- **Eskalacja:** wydłuż interwał timera (decyzja Konrada) lub zmień PAT.
- **Test:** wpisz `evia_github_rate_limit_remaining 100`.

## EviaBackupFailed
- **Znaczenie:** ostatnia kopia bazy nieudana albo starsza niż 26 h.
- **Pierwsza reakcja:** [restore](restore.md): `journalctl -u evia-backup-diff -u evia-backup-full`, `evia-pgbackrest info`, zdarzenie `backup-failed` w `/var/lib/evia/restore/events.jsonl`.
- **Eskalacja:** brak świeżej kopii > 48 h lub uszkodzone repozytorium → procedura odtworzenia w [restore](restore.md); nie usuwaj niczego z bucketu.
- **Test:** wpisz `evia_backup_last_failed 1`.

## EviaMediaCopyFailed
- **Znaczenie:** kopia mediów na Storage Box nieudana albo starsza niż 36 h.
- **Pierwsza reakcja:** `journalctl -u evia-media-copy`, dostęp SFTP do Storage Box ([restore](restore.md)).
- **Eskalacja:** wersjonowanie bucketu mediów pozostaje drugą linią obrony; nie usuwaj wersji.
- **Test:** wpisz `evia_media_copy_last_failed 1`.

## EviaRestoreTestFailed
- **Znaczenie:** test odtworzenia nieudany, spóźniony (> 35 dni), RPO > 900 s albo repozytorium po scenariuszu AC5 niespójne (`evia_restore_repo_heal_failed 1`, **alarm natychmiast**).
- **Pierwsza reakcja:** [restore](restore.md) „Test odtworzenia”, `events.jsonl` (`restore-test-failed`, `restore-repo-heal-failed`).
- **Eskalacja:** niespójne repozytorium → wstrzymaj zmiany, wykonaj pełną kopię i test ręcznie.
- **Test:** wpisz `evia_restore_test_last_rpo_seconds 1000`.

## EviaRestoreResourcesLeftover
- **Znaczenie:** sprzątacz znalazł zasoby testu odtworzenia starsze niż 24 h (usunął je), albo sam zawodzi lub milczy > 3 h.
- **Pierwsza reakcja:** `events.jsonl` (`restore-sweep-deleted`, `restore-sweep-refused`, `restore-sweep-failed`); w konsoli Hetznera projekt `evia-restore-staging` powinien być pusty. Płatne zasoby bez właściciela to koszt.
- **Eskalacja:** `restore-sweep-refused` (zła wartownicza/obcy zasób) → sprawdź token i projekt, nic nie usuwaj ręcznie bez analizy.
- **Test:** wpisz `evia_restore_sweeper_last_deleted 2`.

## EviaGrafanaUsageHigh
- **Znaczenie:** zużycie limitów darmowej Grafany (serie lub objętość logów) przekroczyło 80%. Limit Sentry: powiadomienie o limicie ustawione w Sentry (osobny e-mail) oraz spike protection.
- **Pierwsza reakcja:** zobacz, która usługa wysyła najwięcej (`sum by (service)` w Grafanie), zwiększ filtrowanie w `pipeline.alloy` lub obniż limit szybkości.
- **Eskalacja:** po przekroczeniu limitu dane są odrzucane: oceń płatny plan lub samodzielny hosting (plan wyjścia ADR-0018) — decyzja Konrada.
- **Test:** wartość `grafanacloud_instance_active_series` większa niż próg (w testach `promtool`).

## EviaStagingNoData
- **Znaczenie:** przez 15 min brak metryk ze stagingu: Alloy, VM lub kanał telemetrii nie działają. To kontrola, że same alerty żyją. Wyłącza także inne alerty.
- **Pierwsza reakcja:** czy VM działa (monitoring dostępności z AC3 też alarmuje?), `docker compose --project-name evia-telemetry --env-file /etc/evia/runtime/telemetry.env -f /etc/evia/runtime/compose.telemetry.yaml ps alloy`, logi Alloy (`journalctl CONTAINER_NAME=...`), ważność tokenu zapisu Grafana.
- **Eskalacja:** token wygasł → rotacja niżej. Stos Grafany niedostępny → ocena na stronie statusu; staging działa bez monitoringu, ale blokuj wydania wrażliwe.
- **Test:** zatrzymaj kontener `alloy` na 20 minut.

## EviaSecurityAlert
- **Znaczenie:** aplikacja zgłosiła zdarzenie `alert: "security"` o kodzie z e-maila (`account_locked`, `login_failure_spike`, `second_step_failure_spike`, `emergency_reset`, `projection_authz_drift` i inne z listy). Progi skoków są w aplikacji (EVM-026), warstwa alertów tylko liczy zdarzenia.
- **Pierwsza reakcja:** [aktywacja i tryb awaryjny](aktywacja-i-tryb-awaryjny.md) „alert bezpieczeństwa”; zbadaj zdarzenie po `traceId` w dzienniku audytowym (bez danych osobowych w alercie).
- **Eskalacja:** potwierdzony atak → blokada konta, rotacja kluczy, zgłoszenie incydentu wg polityki.
- **Test:** wywołaj zdarzenie z aplikacji (konto syntetyczne, blokada po serii błędnych haseł) i potwierdź e-mail.

## EviaSecurityAccountLockedBurst
- **Znaczenie:** 5 lub więcej blokad kont w 15 minut (agregacja `account_locked`): możliwy atak szeregowy.
- **Pierwsza reakcja:** jak wyżej; sprawdź źródła (adresy zamaskowane do /24) i czas.
- **Eskalacja:** ograniczenie ruchu na Caddy, zgłoszenie incydentu.
- **Test:** pięć zdarzeń `account_locked` w 15 min na koncie testowym.

## Monitoring dostępności (AC3)
Checki Synthetic Monitoring `/healthz` panelu i API (`infra/observability/synthetic/checks.json`) wysyłają e-mail po przekroczeniu progu porażek i raz po powrocie. To ten sam stos Grafany co metryki, więc awaria stosu wyłącza też ten monitoring (RR-NOC-T3-11); niezależny monitor zewnętrzny dopiero przy produkcji (E8).

## Rotacja tokenu zapisu Grafana (AC8)
Token tworzy wyłącznie Konrad w konsoli Grafana Cloud (access policy z zakresami **tylko** `logs:write` i `metrics:write`, osobny dla staging, data wygaśnięcia ≤ 12 miesięcy; bez zakresów odczytu).
1. Utwórz nowy token (ta sama polityka, nowa data), zapisz w Bitwarden.
2. Na VM: zapisz do `/etc/evia/secrets/grafana-write-token` (0600 root), `systemctl restart evia-secrets`, `docker compose --project-name evia-telemetry --env-file /etc/evia/runtime/telemetry.env -f /etc/evia/runtime/compose.telemetry.yaml up -d`.
3. Sprawdź w Grafanie, że nowe serie i logi `env="staging"` napływają (alert `EviaStagingNoData` nie powinien się zapalić).
4. Unieważnij stary token; zaktualizuj datę w `expiries.json`.
5. **Po incydencie na staging** (podejrzenie przejęcia VM): unieważnij token natychmiast, najpierw utwórz nowy (kroki 1 do 3), potem sprawdź w Grafanie, czy nie pojawiły się serie z etykietą `env="prod"` lub obce etykiety (wspólny stos, RR-24); dopiero po analizie przywróć zbieranie.

## Rotacja DSN Sentry (AC8)
DSN projektów `api` i `web` jest osobny per środowisko; DSN api to sekret na VM (plik `sentry-dsn-api`), DSN web jest publiczny z natury i trafia do panelu w czasie działania (plik konfiguracji serwowany przez evia-web), nie do obrazu.
1. W Sentry (projekt, Client Keys) utwórz nowy klucz, zapisz DSN w Bitwarden.
2. Zapisz nowy DSN w `/etc/evia/secrets/sentry-dsn-api` i w pliku konfiguracji web, `systemctl restart evia-secrets`, ponowne uruchomienie `api`, `worker` (wdrożenie lub `docker compose up -d`).
3. Sprawdź syntetyczny błąd na stagingu (zdarzenie ma `environment=staging`, brak parametrów URL i fragmentu).
4. Usuń stary klucz w Sentry.
5. **Po incydencie na staging:** usuń stary klucz najpierw (zdarzenia ze starego DSN przestają być przyjmowane), potem wykonaj kroki 1 do 3. Sprawdź, że w Sentry „Allowed Domains” i limit na klucz web są ustawione (RR-NOC-T3-12).

## Aktywacja w sesji IaC (kolejność)
Kod obserwowalności jest nieaktywny do tej sesji. Kolejność ma znaczenie: manifest sekretów z nowym plikiem odmówi wdrożenia, dopóki plik nie istnieje.
1. **Tokeny (Konrad, konsola):** Grafana Cloud, access policy tylko z zakresami `logs:write` i `metrics:write`, osobna dla stagingu, z datą wygaśnięcia; Sentry (od wdrożenia SDK): projekty `api` i `web` w organizacji UE, osobne DSN. Poświadczenia administracyjne dla `tofu` (Grafana, Sentry) są sesyjne i wygasają w ciągu 24 h; nie trafiają do stanu ani do repozytorium. Tokenów zapisu nie tworzy `tofu` (nie ma ich w stanie).
2. **Pliki na VM:** `grafana-write-token` w `/etc/evia/secrets` (0600 root; `evia-init-secrets --check` ma go zobaczyć), `/etc/evia/runtime/telemetry.env` (GID `systemd-journal` z `getent group systemd-journal`, adresy Loki i Prometheus oraz identyfikatory instancji), katalog `/var/lib/evia/alloy` (właściciel 10020), konfiguracja Alloy z `infra/observability/alloy` do `/etc/evia/alloy`, `evia-metrics` do `/usr/local/sbin`, jednostki `evia-metrics.service/.timer`, `expiries.json` (nazwy i daty, bez wartości) do `/etc/evia/deploy-agent`.
3. **Dziennik na istniejącej VM (RR-NOC-T3-13):** moduł VM ma `ignore_changes = [user_data]`, więc zmiana `daemon.json` i `journald.conf` w szablonie **nie działa** na już utworzonej maszynie. Ręcznie: w `/etc/docker/daemon.json` ustaw `"log-driver": "journald"` i `"log-opts": {"labels": "com.docker.compose.service,com.docker.compose.project"}` (usuń `max-size` i `max-file`, nie dotyczą journald); `/etc/systemd/journald.conf.d/evia.conf` z `Storage=persistent`, `Compress=yes`, `SystemMaxUse=1G`, `MaxRetentionSec=7day`; `systemctl restart systemd-journald docker`; kontenery trzeba utworzyć ponownie (`docker compose up -d --force-recreate`), bo sterownik logów jest ustalany przy tworzeniu. Dowód: `docker inspect` (LogConfig) i `journalctl -u docker`, zapisane w `docs/qa/EVM-085/`.
3a. **Stała podsieć `evia-runtime` (AC6):** `compose.infra.yaml` ustala podsieć `172.30.10.0/24` i adres Caddy `172.30.10.2`; `ip_range: 172.30.10.128/25` (adresy dynamiczne tylko z górnej połowy, żaden kontener nie zajmie `.2`). Dowód: `docker network inspect evia-runtime` pokazuje `IPRange` i Caddy pod `.2`. `TRUSTED_PROXIES` API i workera zawężamy do tego jednego adresu (`172.30.10.2`) dopiero po odtworzeniu sieci, w commicie sesji IaC: do tego czasu `compose.staging.yaml` zachowuje przejściowy zakres `172.16.0.0/12` (wcześniejsze zawężenie przy innym adresie Caddy zepsułoby adresy klientów: wspólny limit i adres Caddy w audycie). Na istniejącej VM sieć ma inną podsieć: wymaga ponownego utworzenia (krótka przerwa: zatrzymaj kontenery, `docker network rm evia-runtime`, `up -d` infrastruktury, potem wdrożenie kanału). Dowód: `docker network inspect evia-runtime` i test dymny (EVM-076 AC3).
4. **Manifest sekretów** (z usługą `alloy`) instalujemy dopiero po kroku 2.
5. **Start:** `docker compose --project-name evia-telemetry --env-file /etc/evia/runtime/telemetry.env -f /etc/evia/runtime/compose.telemetry.yaml up -d`; w Grafanie widać logi i serie `env="staging"`.
6. **Alerty:** `tofu apply` modułów alertów (po zatwierdzeniu planu przez Konrada), potem test dostarczenia każdego alertu (sekcja „Ogólna procedura testu”).

## Ręczne kontrole w sesji IaC (zakres dowodów)
Członkowie Grafany i Sentry: tylko konto Konrada z MFA, brak kont serwisowych z odczytem. Sentry: region `de`, Data Scrubber i „Prevent Storing of IP Addresses” włączone, retencja 30 dni, spike protection. Grafana: stos w UE, retencja 14 dni. Przegląd próbek zdarzeń i logów (brak danych osobowych i tokenów) przed zamknięciem EVM-085.
