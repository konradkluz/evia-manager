# Operacje — runbooki

> Dokumenty żywe. Właściciel: `devops-engineer`; procedury wykonuje Konrad (konta, ustawienia, scalanie) albo orkiestrator (git lokalnie, push gałęzi za zgodą).

| Runbook | Kiedy | Historyjka |
|---|---|---|
| [`github-i-ci.md`](github-i-ci.md) | ustawienia repozytorium GitHub (Free), CI i bramki, scalanie PR, czerwony `main`, zużycie minut Actions, Renovate, przegląd dostępów | EVM-006 |
| [`rotacja-sekretow.md`](rotacja-sekretow.md) | tokeny i klucze GitHub (Renovate, `gh`, klucz wdrożeniowy agentów), wykryty sekret | EVM-006 |
| [`runbooks/aktywacja-i-tryb-awaryjny.md`](runbooks/aktywacja-i-tryb-awaryjny.md) | pierwszy Administrator (polecenie na serwerze, link 72 h), tryb awaryjny po utracie dostępu, alert bezpieczeństwa | EVM-016 |
| [`runbooks/projekcja-listy-zlecen.md`](runbooks/projekcja-listy-zlecen.md) | `rebuild` i `verify` projekcji listy zleceń (po wdrożeniu, po odtworzeniu bazy, przy alercie rozjazdu) | EVM-034 |
| [`runbooks/wdrozenie-staging.md`](runbooks/wdrozenie-staging.md) | kanał wdrożeń staging (pull z weryfikacją V0–V4), budżet API, pierwsza sesja IaC krok po kroku | EVM-007 |
| [`runbooks/rollback-staging.md`](runbooks/rollback-staging.md) | rollback stagingu poleceniem administratora (tylko commit z rejestru), dostęp awaryjny bez portu 22 | EVM-007 |
| [`runbooks/rotacja-sekretow-kanalu.md`](runbooks/rotacja-sekretow-kanalu.md) | PAT-y kanału (≤ 12 mies.), sekrety aplikacji na VM, tokeny IaC | EVM-007 |
| [`runbooks/incydent-blokada-v0.md`](runbooks/incydent-blokada-v0.md) | push lub force push na `main` poza PR: wstrzymanie, analiza, `gh cache delete --all`, nowa kotwica V0 w sesji IaC | EVM-007 |
| odtworzenie backupu | staging i produkcja | EVM-084, E8 |
