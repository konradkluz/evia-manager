# Runbook: rollback stagingu

> Dokument żywy. EVM-007 AC4 (ADR-0018 „Rollback i migracje”). Właściciel: `devops-engineer`; polecenie wydaje administrator (Konrad albo agent w sesji z dostępem SSH). Powiązane: [wdrożenie](wdrozenie-staging.md), [incydent „blokada V0”](incydent-blokada-v0.md).

## Zasady
- Rollback jest dozwolony **wyłącznie do commita z lokalnego rejestru wdrożeń** (`/var/lib/evia/registry/registry.json`) — weryfikator i `deploy.sh` sprawdzają to niezależnie. Obrazy 3 ostatnich wdrożeń zostają na VM (bez GHCR).
- Rollback **nie cofa migracji**: migracje są tylko „expand” (test `tools/repo-policy/test/migrations.test.ts`), więc wersja N−1 działa na schemacie N. Przy rollbacku `deploy.sh` **nie uruchamia `migrate`** (starszy migrator odrzuciłby bazę z nieznanymi mu migracjami; test `EVM-007 AC4` w `infra/deploy-agent/test/deploy.test.mjs`). W sesji IaC: próbny rollback ponad co najmniej jedną nowszą migrację.
- Automatyczny rollback: gdy V0 wykryje `push`/`force_push`/… w okresie już wdrożonym, weryfikator sam cofa do poprzedniego wpisu rejestru (n5) i blokuje dalsze wdrożenia — dalej [incydent „blokada V0”](incydent-blokada-v0.md).

## Polecenie administratora
1. Dostęp: SSH administratora tylko w sesji IaC (`apply staging` z `admin_ssh_cidrs` = IP administratora). **Bez otwartego portu 22 (break-glass):** konsola Hetzner (Console/VNC w panelu projektu `evia-staging`, logowanie MFA Konrada) — tylko odczyt stanu i polecenie rollbacku; nie otwieraj portu 22 dla „wszystkich”.
2. Wybór commita: `jq -r '.entries[] | "\(.deployedAt) \(.commit)"' /var/lib/evia/registry/registry.json` (ostatni wpis = wdrożony teraz).
3. Polecenie (root): `printf '%s\n' <pełny SHA z rejestru> | sudo tee /etc/evia/deploy-agent/rollback` — najbliższy cykl (≤ 90 s) wykona rollback; `deploy.sh` usuwa plik po udanym przełączeniu.
4. Sprawdzenie: `jq '{decision, commit, reasons}' /var/lib/evia/agent/out/result.json` = `rollback`; `curl -s https://staging.eviacharge.pl/version` zwraca wybrany commit; w rejestrze nowy wpis `"kind": "rollback"` z tym commitem (kopia wcześniejszego wpisu `"kind": "deploy"`: ten sam commit, skróty i zdarzenie Activity).
5. Odrzucenia: `rollback-not-in-registry` (commit spoza wpisów `deploy` rejestru), `rollback-current` (ten commit już działa), `rollback-compose` (plik Compose tego commita różni się od zapisu w rejestrze), `v0-blocked` (powrót do commita z okresu, w którym V0 wykrył naruszenie) — brak zmiany, alert lokalny.
6. **Po rollbacku kanał wstrzymuje wdrożenia** (`decision: none`, powód `held after the rollback to <commit>: waits for a release newer than <frontier>`; bez alertu). „Frontier” to najnowszy wpis `deploy` rejestru — commit, z którego cofnięto; wpis `rollback` go nie przesuwa. Kanał nie wdroży ponownie commita, z którego cofnięto, ani niczego starszego; wdroży dopiero **nowe wydanie** po frontierze — poprawkę albo revert scalony przez Konrada (PR). Commit samej dokumentacji (bez `publish`) nie kończy wstrzymania. Powrót do frontiera bez nowego scalenia: polecenie rollbacku z jego SHA (krok 3).
7. Automatyczny rollback (n5) nie kończy się wstrzymaniem, tylko blokadą: każdy kolejny cykl to `reject` z powodem `v0-blocked: … serves until the baseline moves` aż do przesunięcia `baseline` w sesji IaC ([incydent „blokada V0”](incydent-blokada-v0.md), krok 4).
