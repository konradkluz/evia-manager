---
id: EVM-061
title: Start realnych danych na jedynym środowisku — warunki startu (zamiast osobnej produkcji)
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P0
path: pelna            # realne dane osobowe, uwierzytelnianie, infrastruktura
owner: devops-engineer
contributors: [security-engineer, product-owner]
reviewers: [security-engineer]
depends_on: [EVM-007, EVM-089, EVM-064, EVM-121]
---

# EVM-061: Start realnych danych na jedynym środowisku — warunki startu (zamiast osobnej produkcji)

> **Przepisana 2026-11-13 (decyzja Konrada).** Pierwotna treść (osobne środowisko produkcyjne `evia-prod`, kanał wdrożeń prod z zatwierdzeniem `approvals/prod.json`, osobny monitoring i konta) **nie jest realizowana**: jest **jedno środowisko** — dotychczasowy staging (`staging.eviacharge.pl`) — które od startu obsługuje realne dane firmy; osobnej produkcji nie ma. Przemianowanie staging → produkcja (domena, nazwy, słownictwo) — osobna mała historyjka EVM-125. Kopie zapasowe i test odtworzenia — EVM-084 (sesja IaC B, zaraz po EVM-124); start bez nich jest świadomie zaakceptowanym ryzykiem (AC5). Treść historyczna — historia gita.

## Cel
Jako **właściciel produktu** chcę **jasnej, krótkiej listy warunków, po spełnieniu których Konrad i biuro zaczynają wpisywać realne dane w obecnym środowisku**, aby **zacząć pracować w systemie jak najszybciej, bez osobnej produkcji i bez zbędnych kroków, ale z kontrolą najgroźniejszych ryzyk**.

## Kryteria akceptacji
**AC1 — Konta i dostęp administracyjny (RR-16, SR-INFRA-09)**
- Zakładając środowisko z EVM-007 i konto Konrada (EVM-016)
- Gdy sprawdzam konta
- Wtedy są co najmniej dwa konta Administratora (drugi Administrator albo konto awaryjne — decyzja 7), każde z MFA i co najmniej dwoma kluczami dostępu, a kody odzyskiwania są przechowywane poza telefonem; wszystkie konta administracyjne dostawców (Hetzner, Scaleway, GitHub, Grafana, rejestrator) mają MFA, a runbook zawiera inwentarz kluczy (właściciel, miejsce, rotacja).

**AC2 — E-mail i domena (EVM-089, EVM-121)**
- Gdy zaproszenia i reset hasła wychodzą do prawdziwych adresów
- Wtedy EVM-089 jest `done` (SPF, DKIM, DMARC `p=reject`), a rekordy CAA i `rua` z EVM-121 są ustawione, a `staging-verify` w profilu `strict` jest zielony bez ostrzeżeń.

**AC3 — RODO przed pierwszymi danymi klientów (EVM-064)**
- Gdy do systemu trafiają dane klientów
- Wtedy EVM-064 jest `done` (umowy powierzenia i transfery, rejestr czynności, runbooki, uproszczona DPIA albo udokumentowana decyzja o jej zbędności) albo Konrad zapisał w „Decyzje” świadomą zgodę na start przed jej zakończeniem — z terminem i wskazanymi punktami.

**AC4 — Dane syntetyczne i realne (decyzja 4 z 2026-11-13)**
- Gdy w środowisku są dane syntetyczne i realne
- Wtedy dane testowe są rozpoznawalne (adresy `.test` / `example.com`, nazwa z prefiksem „TEST”), nie wysyłają poczty (EVM-089 AC2), a runbook opisuje, jak je usunąć albo zostawić; realne zlecenia zakłada Konrad / biuro po zgodzie z AC6.

**AC5 — Start bez kopii zapasowych (świadome ryzyko)**
- Gdy start następuje przed EVM-084
- Wtedy ryzyko braku kopii jest zapisane jako ryzyko rezydualne (numer RR nadaje `security-engineer`) z terminem „EVM-084 zaraz po EVM-124” i zaleceniem dla biura (równoległe dotychczasowe narzędzia do czasu pierwszego udanego testu odtworzenia); ryzyko ma decyzję Konrada.

**AC6 — Zgoda na start**
- Zakładając AC1–AC5
- Gdy środowisko jest gotowe
- Wtedy start realnych danych następuje dopiero po wyraźnej zgodzie Konrada, zapisanej w „Decyzje” z datą (zastępuje „zgodę na pierwsze wdrożenie prod”).

## Poza zakresem
- Osobne środowisko produkcyjne, osobny projekt dostawców, kanał wdrożeń prod z zatwierdzeniem digestu — nie realizujemy (jedno środowisko; ewentualny powrót do dwóch środowisk — nowa historyjka).
- Przemianowanie staging → produkcja — EVM-125. Kopie zapasowe, test odtworzenia — EVM-084 (z EVM-062). Alerty i monitoring — EVM-085. Security review wydania 1.0 — EVM-070.
- Dystrybucja aplikacji mobilnej — M2 (E14).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (proces) — konta wg AC1 |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | tylko 80/443 (Caddy) |

- Dane: od startu realne dane osobowe klientów i pracowników na środowisku o nazwie „staging” (do EVM-125) — ryzyka rezydualne: brak kopii (AC5), brak zewnętrznego pentestu (decyzja 2026-11-13; EVM-070 jako wewnętrzny przegląd), wdrożenia automatyczne po scaleniu do `main` na środowisko z realnymi danymi (do oceny `solution-architect` / `security-engineer` — adnotacja do ADR-0018).
- W AC: SR-INFRA-09, SR-CRYPTO-04, SR-INFRA-12, SR-PRIV-06. Ryzyka: RR-10 (zmieniony), RR-16, nowe RR (AC5).

## Notatki techniczne
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-11-13 — Konrad: jedno środowisko (obecny staging staje się produkcją; osobnej produkcji nie ma), start od razu na realnych danych, bez kopii zapasowych na starcie (EVM-084 zaraz po EVM-124), bez zewnętrznego pentestu, dane syntetyczne zostają.

## Uwagi do rozważenia
- RODO przed realnymi danymi klientów (AC3): EVM-064 to głównie dokumenty — rekomendacja: wykonać zaraz po EVM-089 (równolegle z jej oczekiwaniem na DNS).

## Definition of Done
- [ ] AC1–AC6 spełnione, dowody bez sekretów i danych osobowych
- [ ] Przegląd: security-engineer — APPROVE
- [ ] Runbooki (`docs/ops/runbooks/`) i `CHANGELOG.md` zaktualizowane
- [ ] Zgoda Konrada na start (AC6)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): odesłanie do bramki wdrożeń w trakcie pilota (EVM-065 AC7)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-13 — podział EVM-007 wg ADR-0018: te same skrypty to kanał i VM (007a), backupy (EVM-084 = 007b) i obserwowalność (EVM-085 = 007c); `depends_on` + EVM-084, EVM-085. Zmiana AC (AC2, AC5, AC6 wg ADR-0018) zaakceptowana przez Konrada 2026-10-13; liczba AC bez zmian (product-owner)
- 2026-11-12 — zmiana AC (decyzja Konrada 2026-11-12, bez Sentry): AC4 (alerty) i AC5 (MFA kont) bez Sentry; bramka wdrożeń w trakcie pilota (EVM-065 AC7) usunięta po połączeniu EVM-065 z EVM-070 (Tech Lead z delegacji Konrada)
- 2026-11-13 — przepisana wg decyzji Konrada „jedno środowisko”: z osobnej produkcji na krótką listę warunków startu realnych danych (AC1 konta — dawne AC7/AC8, AC2 e-mail/domena, AC3 RODO, AC4 dane syntetyczne, AC5 start bez kopii, AC6 zgoda); dawne AC1–AC6 (osobna infrastruktura, kanał prod, alerty prod, kopie prod) wycofane; status `draft` do akceptacji Konrada, P1 → P0 (product-owner)
- 2026-11-13 — akceptacja w ramach decyzji Konrada z 2026-11-13 (jedno środowisko, start bez kopii z terminem 2026-12-13, zasady RR-93, e-mail EVM-089); status `ready` (Tech Lead)
