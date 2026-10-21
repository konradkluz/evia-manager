# Runbook: incydent „blokada V0” (push lub force push na `main` poza PR)

> Dokument żywy. EVM-007 AC8 (ADR-0018 „Procedura incydentu »blokada V0«”, B1c). Właściciel: `devops-engineer`; kroki 3–5 wykonuje wyłącznie Konrad (konto GitHub, sesja IaC). Powiązane: [GitHub i CI → „Czerwony main”](../github-i-ci.md), [rollback](rollback-staging.md), [wdrożenie](wdrozenie-staging.md).

**Objaw:** cykl kanału kończy się `reject` z powodem `v0-blocked: v0-event-type: push|force_push|branch_deletion|branch_creation|merge_queue_merge|…` albo `v0-actor` / `v0-ref` / `v0-chain`; alert w `/var/lib/evia/agent/alerts.log` (e-mail od EVM-085); K6 (`main-integrity`) zwykle też czerwony. Gdy zdarzenie wpadło w okres już wdrożony, weryfikator sam wykonał rollback do poprzedniego wpisu rejestru (`decision: rollback`).

1. **Wstrzymanie (automatyczne):** dopóki zdarzenie jest w oknie V0, żadne wdrożenie nie przejdzie. Nie wyłączaj timera ani weryfikatora i nie zmieniaj jego konfiguracji poza sesją IaC.
2. **Analiza** wg [`github-i-ci.md`](../github-i-ci.md) → „Czerwony `main`”: kto, kiedy, jaki commit (Activity repozytorium, log K6); czy na staging trafił obraz z okresu incydentu (`jq '.entries[-3:]' /var/lib/evia/registry/registry.json`, `result.json`). Zapis w historii incydentu (bez danych osobowych w repozytorium).
3. **Cache Actions:** Konrad usuwa wszystkie cache repozytorium: `gh cache delete --all` (z konta Konrada) — zatruty cache mógłby przetrwać w zakresie `main` (TM-112).
4. **Nowa kotwica V0 (sesja IaC Konrada):** gdy `main` jest znów czysty (revert przez PR scalony przez Konrada), w `/etc/evia/deploy-agent/config.json` ustaw `baseline.commit` = bieżący HEAD `main` i `baseline.activityEventId` = ID zdarzenia Activity, które ustawiło ten commit (`gh api "repos/<owner>/<repo>/activity?ref=refs/heads/main&per_page=5"` z konta Konrada). Wpisy rejestru ze starym `baseline` przestają być kotwicą (nowy łańcuch). Tylko w sesji IaC — kanał nie zmienia konfiguracji.
5. **Pierwsze wdrożenie po incydencie z nowego `publish`:** scal PR (choćby drobny) zmieniający wejście budowy, żeby powstał nowy przebieg `publish` (bez cache, po wyczyszczeniu cache Actions); obserwuj `decision: deploy` i zielony `staging-verify`.
6. Zamknięcie: wpis `ACKNOWLEDGED` w K6 (procedura w `github-i-ci.md`), notatka w retrospektywie; przy podejrzeniu wycieku PAT — [rotacja](rotacja-sekretow-kanalu.md).
