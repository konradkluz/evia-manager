---
id: EVM-121
title: Rekordy CAA i rua oraz profil strict w staging-verify dla jedynego środowiska
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: in-review
priority: P1
path: lekka            # narzędzie, CI i DNS; bez uwierzytelniania, danych osobowych i mediów; jeden recenzent (zmiana .github/** → security-engineer)
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-089]
---

# EVM-121: Rekordy CAA i rua oraz profil strict w staging-verify dla jedynego środowiska

## Cel
Jako **właściciel produktu** chcę, **aby jedyne środowisko (`panel.eviacharge.pl`) przed startem realnych danych miało pełne zabezpieczenia DNS (CAA, DMARC z `rua`) i aby kontrola `staging-verify` działała w pełnym rygorze bez łagodzeń**, aby **wyjątki z czasów stagingu (RR-40, RR-41) nie zostały na środowisku z prawdziwymi danymi**. To warunek startu realnych danych: EVM-061 (AC2) ma tę historyjkę w `depends_on`. Osobnej produkcji i workflow `prod-verify` nie ma (decyzja Konrada 2026-11-13).

Stan na 2026-11-15 (publiczny DNS): `panel.eviacharge.pl` ma CAA `0 issue "letsencrypt.org"`, `_dmarc.panel.eviacharge.pl` ma `p=reject` i `rua`. Rekordu `issuewild` nie ma i nie będzie: panel OVH nie przyjął wartości `;` (Konrad, 2026-11-15). Profil `strict` narzędzia wymaga dziś dokładnie jednego `issuewild ";"`, więc dałby czerwony wynik — historyjka zmienia tę kontrolę zamiast rekordu.

## Kryteria akceptacji

**AC1 — Kontrola CAA bez wymogu rekordu `issuewild`**
- Zakładając, że `panel.eviacharge.pl` ma CAA `0 issue "letsencrypt.org"` i nie ma `issuewild`
- Gdy kontrola `dns` ocenia rekordy CAA
- Wtedy wynik jest zielony bez ostrzeżeń dla dokładnie jednego `issue` z `letsencrypt.org` (`accounturi` opcjonalny) oraz braku `issuewild` albo jednego `issuewild ";"` — według RFC 8659 przy braku `issuewild` certyfikaty wildcard podlegają rekordowi `issue`, czyli może je wystawić wyłącznie Let's Encrypt. Przypadki negatywne (czerwony wynik, osobny test każdego): brak `issue`, drugi `issue`, `issue` innego CA, `issuewild` o wartości innej niż `;`, więcej niż jeden `issuewild`.

**AC2 — Job `staging-verify` w profilu `strict`**
- Zakładając job `staging-verify` w `.github/workflows/ci.yml`, który dziś ustawia `VERIFY_PROFILE: staging`
- Gdy zmiana usuwa tę zmienną (domyślnie obowiązuje `strict`) i job działa na `main` po wdrożeniu
- Wtedy krok „Ports, TLS, headers and DNS” jest zielony bez ostrzeżeń (`warnings` puste), a przebieg CI jest dowodem zapisanym w `docs/qa/EVM-121/` (bez sekretów i adresów e-mail). Przypadek negatywny: test offline z atrapą resolvera zwracającą `issue` innego CA albo DMARC bez `rua` kończy ten sam krok czerwono.

**AC3 — Łagodniejszy profil nie wraca niezauważenie**
- Zakładając narzędzie `tools/staging-verify/`, które zna dziś profile `strict` i `staging`
- Gdy z narzędzia zostaje usunięty profil `staging` (jedyny profil to `strict`; ostrzeżenia RR-40/RR-41 znikają z kodu)
- Wtedy każda ustawiona `VERIFY_PROFILE` (także `staging` i wartość nieznana) kończy kontrolę `dns` czerwono z komunikatem o niedozwolonym profilu, brak zmiennej = `strict`; testy obejmują trzy przypadki (brak, `staging`, nieznana). Wybór: usunięcie profilu zamiast reguły w `repo-policy`, bo kod, którego nie ma, nie wymaga straży, a nie dodajemy nowej reguły do utrzymania.

**AC4 — Zamknięcie ryzyk i dokumentacja**
- Zakładając AC1–AC3 spełnione
- Gdy `security-engineer` przegląda zmianę
- Wtedy RR-40 i RR-41 w `docs/security/threat-model.md` są oznaczone jako zamknięte (z odwołaniem do dowodu w `docs/qa/EVM-121/`), z zapisaną oceną braku `issuewild` (AC1); `README.md` narzędzia i runbook `wdrozenie-staging.md` (krok 4) nie opisują profilu `staging`, „CAA pominięte” ani obowiązkowego `issuewild ";"`, a `npm run docs:check` kończy się 0 błędów. Przypadek negatywny: dowód zawierający adres e-mail, token lub dane firmy jest odrzucany w przeglądzie.

## Kolejność realizacji
1. Bez kroków ręcznych: rekordy DNS zostają takie, jakie są.
2. Przed zgłoszeniem PR agent sprawdza publiczny DNS (CAA: jeden `issue` z `letsencrypt.org`; DMARC z `rua`) — bez łączenia się ze środowiskiem.
3. PR scala Konrad; po wdrożeniu `staging-verify` na `main` jest zielony w `strict`, a odnośnik do przebiegu trafia do `docs/qa/EVM-121/` (w następnym PR, razem ze statusem `done`).

## Poza zakresem
- Reguła w `repo-policy` pilnująca profilu (zastąpiona usunięciem profilu, AC3).
- Rekord `issuewild` w OVH (panel nie przyjmuje wartości `;`; zastąpiony zmianą kontroli, AC1).
- `accounturi` w rekordzie `issue` (opcjonalne, narzędzie go toleruje; YAGNI), `iodef` w CAA, CAA na domenie głównej `eviacharge.pl`.
- Zmiana wyboru CA (Let's Encrypt, decyzja Konrada 2026-10-28), zmiana polityki DMARC (`p=reject` zostaje).
- Przemianowanie staging → produkcja (EVM-125) i reszta uruchomienia środowiska (EVM-061).

## Decyzje i ograniczenia
- Agenci nie logują się do środowiska ani do OVH; dowody wyłącznie z publicznego DNS i przebiegów CI. Historyjka nie wymaga żadnego kroku ręcznego.
- **Brak `issuewild` (Tech Lead z delegacji Konrada, 2026-11-15 — „wybierz inne najlepsze rozwiązanie”):** zamiast rekordu `issuewild ";"` kontrola przyjmuje jego brak. Różnica: Let's Encrypt mógłby wystawić certyfikat wildcard dla `*.panel.eviacharge.pl`, co wymaga potwierdzenia przez DNS (DNS-01), czyli kontroli nad strefą — a kto ją ma, może też zmienić CAA. Ocena `security-engineer` w przeglądzie; gdyby uznał brak `issuewild` za nieakceptowalny, wariant zapasowy to wpisanie rekordu w OVH w trybie tekstowym strefy (krok ręczny Konrada).
- Rygor `strict` obejmuje także A, AAAA, SPF (`-all` lub `~all`) i DMARC z `rua`; dziś oczekujemy, że są spełnione (do potwierdzenia przebiegiem narzędzia w AC2).
- Ryzyka RR-40 i RR-41 zostały zaakceptowane tylko dla stagingu z danymi syntetycznymi; przy realnych danych (RR-93) wymagają zamknięcia, nie ponownej akceptacji.
- Uzasadnienie ścieżki `lekka`: narzędzie i CI bez obszarów ryzyka z tabeli; 4 AC; jedyny recenzent `security-engineer` z powodu zmiany `.github/**` (workflow „Ścieżki realizacji”).

## Notatki
- Przegląd `security-engineer` (2026-11-15): APPROVE, bez blocker/major; brak `issuewild` akceptowalny (RFC 8659 §4.3; wildcard Let's Encrypt tylko po DNS-01), wariant zapasowy zbędny. Uwagi minor w `docs/security` naniesione (`threat-model.md`, `requirements.md`, `policies.md`).
- **RR-99 (nowe, Low, do akceptacji Konrada):** `staging.eviacharge.pl` (samo przekierowanie 308) nie ma CAA; rekomendacja: dodać `0 issue "letsencrypt.org"` na tym węźle przy najbliższej wizycie w OVH.
- Propozycja do backlogu (`/refine`): kontrola `dns` przyjmuje DMARC `p=none`, nie sprawdza `sp=` i przepuszcza kilka rekordów DMARC — wymagać dokładnie jednego rekordu z `p=reject` (albo `quarantine`), `sp=reject` i `rua` (kod sprzed tej historyjki).
- Nit: komunikat „brak SPF dla staging” w `checks.mjs` — poprawić przy EVM-125 (przemianowanie staging → produkcja).
- Dowód AC2 (zielony `staging-verify` na `main` po scaleniu) i odwołanie do niego z RR-40/RR-41 (AC4) trafią do `docs/qa/EVM-121/` w następnym PR, razem ze statusem `done`.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z zamknięcia EVM-007
- 2026-10-28 — decyzja Konrada (pytania po nocnej kolejce): bez zależności od EVM-061; rekord CAA Let's Encrypt (RR-40) dopiero przed produkcją.
- 2026-11-13 — triage wg decyzji „jedno środowisko” (product-owner): „produkcja” = jedyne środowisko (obecny staging), więc **warunek startu realnych danych** (EVM-061 AC2; `depends_on` w EVM-061 dodane mimo decyzji z 2026-10-28, bo osobnej produkcji nie ma); „łagodzenie stagingu” (RR-40/41) przestaje obowiązywać — profil `strict` i CAA/`rua` dotyczą tego środowiska; AC1 (DNS w OVH) robić w tej samej sesji co EVM-089 AC3 (jedna wizyta w OVH); AC2–AC3 czytaj bez rozróżnienia staging/prod; AC bez zmian, do akceptacji Konrada
- 2026-11-15 — przepisano dla jedynego środowiska (product-owner): sprawdzono publiczny DNS i kod `evaluateDns` — brakuje tylko `issuewild ";"`; `rua` i `issue` są; usunięto `prod-verify` i „produkcję” z AC; 4 AC; profil `staging` do usunięcia z narzędzia zamiast reguły `repo-policy`; dodano kolejność realizacji; `depends_on` rozszerzone o EVM-089 (done); status `draft` do akceptacji Konrada
- 2026-11-15 — akceptacja Konrada (DoR): panel OVH nie przyjął `issuewild ";"`, więc z delegacji Konrada AC1 zmienione z rekordu DNS na kontrolę przyjmującą brak `issuewild` (RFC 8659); bez kroków ręcznych; profil `staging` usuwany z narzędzia, bez `accounturi`, RR-40 i RR-41 zamyka `security-engineer`; ścieżka `lekka`; **status `ready`** (Tech Lead)
- 2026-11-15 — start realizacji (`/deliver`, ścieżka `lekka`, gałąź `feature/EVM-121-caa-i-profil-strict`); **status `in-progress`** (Tech Lead)
- 2026-11-15 — implementacja (devops-engineer): kontrola `dns` bez profili (brak `issuewild` albo jedno `";"`, osobne testy negatywne AC1, `VERIFY_PROFILE` ustawiona = czerwono), `ci.yml` bez `VERIFY_PROFILE`, README, runbook (krok 4 i 6), RR-40/RR-41 oznaczone jako zamknięte do oceny `security-engineer`, CHANGELOG; publiczny DNS potwierdzony (CAA jeden `issue letsencrypt.org`, DMARC z `rua`); dowód AC2 (zielony `staging-verify` na `main`, bez adresów e-mail) do zapisania w `docs/qa/EVM-121/` po scaleniu PR
- 2026-11-15 — uwagi minor z przeglądu naniesione w docs/security (security-engineer)
- 2026-11-15 — weryfikacja orkiestratora (ścieżka `lekka`): tabela AC → test sprawdzona (AC1: 9 testów `EVM-121 AC1`; AC2 i AC3: test podsumowania i przypadek DMARC bez `rua`; AC4: dokumenty), `pnpm run gate` zielona (pokrycie zmienionego kodu 100% linii i gałęzi), `npm run test:tools` zielone, `npm run docs:check` 0 błędów, `pnpm run scan` zielony (zizmor i actionlint bez ustaleń), publiczny DNS zgodny z rygorem; **status `in-review`** (Tech Lead)
- 2026-11-15 — Koszt: bez rozbicia w $ (nieodczytane w sesji) — ok. 0,21 mln tokenów subagentów (workflow 0,14 mln + poprawka dokumentów 0,07 mln); wywołania agentów 3; rundy poprawek 0; ścieżka lekka; sonnet; plik historyjki ok. 12 KB; vs baseline: szacunkowo wyraźnie poniżej celu ścieżki lekkiej
