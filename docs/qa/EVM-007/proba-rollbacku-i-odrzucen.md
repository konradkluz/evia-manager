# EVM-007 — próba rollbacku i dowody odrzuceń wdrożenia (staging)

Data: 2026-10-27. Środowisko: staging (`staging.eviacharge.pl`, VM Hetzner CAX11). Historyjka: [EVM-007](../../backlog/M0/EVM-007-staging-wdrozenia-backupy-monitoring.md) (AC4). Procedura: [rollback stagingu](../../ops/runbooks/rollback-staging.md). Dowody to wyjątki z `journalctl -u evia-deploy-agent`, `/var/lib/evia/registry/registry.json` i odpowiedzi `/version`, `/healthz` zebrane na VM (bez sekretów).

**Wynik: PASS** dla rollbacku do commita z rejestru i powrotu oraz dla odrzuceń przy porażce migracji i testu zdrowia. **Nie wykonano:** rollbacku ponad nowszą migrację (patrz „Otwarte”).

## 1. Próba rollbacku (polecenie administratora)
Rejestr przed próbą: `deploy fa3597b` (15:51:52Z), `deploy aad42ae` (20:05:54Z). `aad42ae` to drugie wydanie (etykieta OCI, PR #104); wdrożone przez weryfikator ≤ 15 min od scalenia, `staging-verify` zielony z ostrzeżeniami DNS (RR-40, RR-41).

| Krok | Wynik | Dowód |
|---|---|---|
| Polecenie `printf '%s\n' <SHA fa3597b> \| sudo tee /etc/evia/deploy-agent/rollback` o 20:19:45 | plik skonsumowany po ok. 50 s (≤ 1 cykl) | `result.json`: `decision: rollback`, powód „rollback on the administrator's command to fa3597b…” |
| Stan po rollbacku | PASS | `/version` = `fa3597b…` z `manifestSha256` `a8ac005f…`; `/healthz` 200; kontenery `evia-blue-*` Up; Caddy i Postgres bez restartu |
| Rejestr | PASS | nowy wpis `rollback 20:20:34Z fa3597b` (kopia wcześniejszego wpisu `deploy`) |
| Wstrzymanie kanału po rollbacku | PASS | kolejny cykl: `decision: none`, powód „held after the rollback to fa3597b: waits for a release newer than aad42ae” |
| Powrót do frontiera (polecenie z SHA `aad42ae`) o ok. 20:22 | PASS, ok. 90 s | `/version` = `aad42ae…` z `manifestSha256` `8c189251…`; `/healthz` 200; kontenery `evia-green-*` Up; wpis `rollback 20:23:54Z aad42ae` |

Rollback nie uruchamia `migrate` (zgodnie z runbookiem); baza `evia` nie była dotykana.

## 2. Odrzucenie przy porażce migracji (dowód z żywego stagingu)
2026-10-27, pierwsza próba wdrożenia `f6e15b5` (rola `evia_migrator` bez uprawnienia `CREATEROLE`, błąd bazy `42501`):
```
13:51:07Z deploy: deploying f6e15b55… as evia-blue
13:51:09Z deploy: REFUSED: migration failed — the previous version stays
```
Skutek: brak przełączenia ruchu; poprawka w PR #97 (migracja `0002_roles` tworzy `evia_app` tylko gdy jej brak).

## 3. Odrzucenie przy porażce testu zdrowia (dowód z żywego stagingu)
2026-10-27, wdrożenie `15ab2fc` (kontener `evia-blue-web-1` w pętli restartów: `exec /usr/bin/caddy: operation not permitted`, plik binarny z file capability pod `cap_drop: ALL`). Migracja przeszła („migrations applied”), `api` i `worker` wystartowały, test zdrowia/wersji nie przeszedł:
```
13:52:51Z deploy: deploying 15ab2fc4… as evia-blue
13:54:04Z deploy: REFUSED: health or version check of evia-blue failed — the previous version stays
```
(powtarzane co cykl do 15:49:58Z). Skutek: poprzednia wersja (brak wdrożonej) pozostała; `/healthz` placeholdera 503. Poprawka w PR #100; następne wdrożenie `fa3597b` zakończone „deployed” o 15:51:54Z.

## Otwarte
- **Rollback ponad nowszą migrację** (AC4 + runbook „próbny rollback ponad co najmniej jedną nowszą migrację”): do tej pory wydania `fa3597b` i `aad42ae` mają ten sam schemat bazy. Próba zostaje przeniesiona do **pierwszego wydania z migracją** (planowo EVM-094) jako warunek sprawdzenia po jego wdrożeniu; zapis w historyjce tamtego wydania.
- Ostrzeżenia DNS (CAA, `rua`): RR-40, RR-41 — przed produkcją.
