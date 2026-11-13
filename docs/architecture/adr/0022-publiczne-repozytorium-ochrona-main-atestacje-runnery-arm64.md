# ADR-0022: Publiczne repozytorium — natywna ochrona `main` rulesetem, atestacje pochodzenia i runnery arm64

- **Status:** Zaakceptowana (Konrad, 2026-11-12)
- **Data:** 2026-11-12
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-085 (uproszczenia z 2026-11-12), EVM-124 (obrazy infrastruktury w CI), EVM-088 i EVM-123 (wycofane drafty `main-integrity`); ADR-0016 (częściowo zastępuje — K6, założenie „GitHub Free + repozytorium prywatne”, warunki powrotu do planu płatnego, K5 „wyłączone forkowanie”), ADR-0018 (doprecyzowuje — atestacje, minuty Actions, runnery arm64, plan GitHub), ADR-0012, ADR-0015; RR-21; incydent PR #106; `docs/ops/github-i-ci.md`

## Kontekst i problem
ADR-0016 i ADR-0018 zakładały **repozytorium prywatne na GitHub Free**: bez rulesetów, z ochroną `main` wykrywającą po fakcie (K6 `main-integrity`, przegląd Activity — K2), z pulą 2000 min Actions, bez atestacji artefaktów (w repo prywatnym tylko Enterprise Cloud) i z budową obrazów arm64 krzyżowo na runnerze x86.

2026-11-12 ustalono, że repozytorium jest **publiczne** (`gh repo view` → `PUBLIC`; data upublicznienia nieustalona, co najmniej od 2026-10-22). Konrad potwierdził, że to **świadoma decyzja** i że repozytorium zostaje publiczne. Zmienia to dostępne mechanizmy GitHuba bez dopłat: rulesety, bezpłatne minuty na standardowych runnerach, atestacje pochodzenia i runnery `ubuntu-24.04-arm`. Jednocześnie K6 generuje koszty utrzymania (fałszywe alarmy przy rebase/merge — drafty EVM-088, EVM-123), a incydent PR #106 (scalenie przed zakończeniem `ci-gate`) pokazał, że wykrywanie po fakcie nie wystarcza. Kontekst nadrzędny — Konrad, 2026-11-12: „chcę cały system zrobić jak najtaniej i jak najszybciej, bez zbędnych rzeczy”; bezpieczeństwo danych, kopie z odtworzeniem i RODO zostają.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Egzekwowanie ochrony `main` (blokada, nie wykrycie) | 5 | incydent #106; RR-21; agenci AI z kluczem wdrożeniowym |
| Koszt | 4 | „jak najtaniej”; budżet 300 zł/mies. |
| Prostota i narzut utrzymania | 4 | jedna osoba; własne narzędzie K6 = kod bezpieczeństwa do utrzymania |
| Łańcuch dostaw (atestacje pochodzenia, natywna budowa arm64) | 3 | EVM-124 (RR-78), VM stagingu na arm64 |
| Poufność treści repozytorium | 3 | dokumentacja bezpieczeństwa i infrastruktury jest jawna |
| Odwracalność | 2 | |

## Rozważane opcje
1. **A — repozytorium publiczne + natywny ruleset `main`**; K6 usunięta.
2. **B — repozytorium publiczne + K6 jak dziś** (naprawa fałszywych alarmów wg EVM-088, EVM-123); bez rulesetu.
3. **C — powrót do repozytorium prywatnego + GitHub Pro** (≈ 15,50 zł/mies.): ruleset, 3000 min; bez atestacji (Enterprise), runnery arm64 w puli minut (2 vCPU).

## Ocena
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Egzekwowanie ochrony `main` (5) | 5 | 1 | 5 |
| Koszt (4) | 5 | 5 | 4 |
| Prostota (4) | 5 | 2 | 4 |
| Łańcuch dostaw (3) | 5 | 5 | 2 |
| Poufność treści (3) | 2 | 2 | 5 |
| Odwracalność (2) | 3 | 4 | 4 |
| **Suma ważona (maks. 105)** | **92** | **62** | **86** |

Poufność w C jest oceniona teoretycznie — treść była publiczna co najmniej od 2026-10-22, więc zmiana widoczności nie cofa już wykonanych kopii. Odwracalność A obniżona z tego samego powodu. Informacje o planach i funkcjach GitHub zweryfikowane 2026-11-12 (źródła niżej).

## Decyzja
Wybieramy **A — repozytorium publiczne z natywną ochroną `main` rulesetem GitHuba zamiast własnej kontroli K6**, ponieważ daje twardą blokadę (także dla `GITHUB_TOKEN` z workflowu gałęzi — luka „obejścia złośliwego” z ADR-0016) przy koszcie 0 zł i usuwa własne narzędzie do utrzymania.

**1. Ruleset `main`** (ustawia Konrad w UI w posiedzeniu A; konfiguracja i dowód — `docs/ops/github-i-ci.md`):
- cel: gałąź domyślna `main`, egzekwowanie `Active`, **pusta lista obejść** (także bez roli administratora);
- tylko przez PR (bez wymaganej liczby akceptacji — jedna osoba nie zatwierdza własnego PR), **dozwolona metoda scalania: squash**;
- **wymagany status `ci-gate`** (źródło: aplikacja GitHub Actions) — PR z oczekującym lub czerwonym `ci-gate` nie da się scalić (incydent #106);
- **blokada force pushu i usuwania** gałęzi.

**2. Usunięcie K6.** Workflow `.github/workflows/main-integrity.yml` i `tools/main-integrity` zostają usunięte (`devops-engineer`); drafty EVM-088 i EVM-123 wycofane. Zmiany pozostałych kontroli ADR-0016:

| Kontrola ADR-0016 | Po ADR-0022 |
|---|---|
| K1 (CI, jeden check `ci-gate`) | bez zmian; `ci-gate` jest teraz **wymaganym statusem** rulesetu |
| K2 (scala wyłącznie Konrad, squash, przegląd Activity) | scalanie bez zmian; bezpośredni push i force push na `main` blokuje ruleset, więc przegląd Activity przestaje być jedyną kontrolą obejścia — niezależną kontrolą pozostaje **V0** kanału wdrożeń (ADR-0018) |
| K3 (pliki wrażliwe, `CODEOWNERS`) | bez zmian — to główna mitygacja PR, który zmienia definicję `ci-gate` w `.github/**` |
| K4 (uprawnienia agentów) | bez zmian |
| K5 (ustawienia repozytorium) | bez zmian poza **„wyłączone forkowanie”** — niewykonalne w publicznym repozytorium konta osobistego; zamiast tego **zatwierdzanie workflowów z PR-ów z forków dla wszystkich zewnętrznych kontrybutorów** (Settings → Actions → General); zakaz `pull_request_target` i `workflow_run` na kodzie z forków (zizmor) |
| K6 (`main-integrity`) | **zastąpiona rulesetem** |
| K7 (minimum sekretów) | bez zmian — **zero sekretów wdrożeniowych w GitHubie** (ADR-0018); środowiska z sekretami, dostępne na Free w repo publicznym, nie są używane |

**3. Pakiety GHCR — publiczne, ze skanem sekretów obrazów przed publikacją.** *2026-11-13, decyzja Konrada: pakiety GHCR publiczne (kod z publicznego repo), warunek: skan sekretów obrazów przed publikacją.* Pierwotnie pakiety miały być prywatne (SR-INFRA-09). Pakiety `evia-api` i `evia-web` są publiczne (anonimowe pobranie działa) i **pozostają publiczne**; nowe pakiety infrastruktury (`evia-postgres-pgbackrest`, `evia-media-processor`) mogą być publiczne — powstają przy pierwszym pushu z CI, bez ręcznego tworzenia. Obrazy zawierają wyłącznie kod z publicznego repozytorium; wymagane jest to, że nic innego (sekret, klucz, token) nie trafia do obrazu: Trivy `--scanners secret` (każdy poziom ważności = czerwony, bez wyjątków) skanuje w `publish` i `publish-infra` zapisane archiwa obrazów przed logowaniem do GHCR i pushem. Pakiet publiczny nie daje uprawnień do zapisu; dostęp VM bez zmian (PAT classic `read:packages` nadal działa, pobranie anonimowe także).

**4. Atestacje pochodzenia** (`actions/attest-build-provenance`, od v4 nakładka na `actions/attest`) są dostępne w repozytoriach publicznych na wszystkich bieżących planach. Pierwsze użycie: obrazy infrastruktury (EVM-124; adnotacja w ADR-0018). Job atestujący potrzebuje `id-token: write` i `attestations: write`. Podpis przez publiczną instancję Sigstore — wpis (repozytorium, workflow, commit, digest) trafia do **publicznego logu przejrzystości**, co przy jawnym repozytorium jest akceptowalne. **Atestacja nie jest granicą zaufania sama w sobie** — workflow z dowolnej gałęzi też może atestować, więc weryfikacja (`gh attestation verify`) wymaga `--signer-workflow` = `ci.yml` i `--source-ref refs/heads/main`. Weryfikator `evia-verifier` i V0–V4 bez zmian; ewentualne sprawdzanie atestacji w kanale wdrożeń — osobna decyzja (EVM-122 / m5).

**5. Runnery i minuty.** Standardowe runnery GitHub w repozytorium publicznym są bezpłatne bez limitu minut, w tym **`ubuntu-24.04-arm`** (4 vCPU) — natywna budowa `linux/arm64` bez QEMU. Etykiety przypięte do wersji (`ubuntu-24.04-arm`, nie `*-latest`). Próg ponownej decyzji o planie z ADR-0018 („Minuty Actions”: > 1600 min) **nie obowiązuje**, dopóki repozytorium jest publiczne; mitygacje triggera K1 mogą zostać ze względu na czas przebiegu (decyzja `devops-engineer`, bez ADR).

**6. Higiena treści publicznych.** Wszystko, co trafia do repozytorium (kod, dokumentacja, historia, logi i artefakty przebiegów Actions, PR-y), jest publiczne:
- bez sekretów — gitleaks całej historii 2026-11-12: **0 znalezisk**; gitleaks w hooku i w CI bez zmian;
- bez prawdziwych danych osobowych (zasada istniejąca: tylko dane syntetyczne);
- **jawne i akceptowane** (Konrad, 2026-11-12): nazwy bucketów, domena stagingu, opis architektury i model zagrożeń — bezpieczeństwo nie opiera się na tajności konfiguracji (polityki bucketów Deny dla obcych kluczy, SR-INFRA-02; zero sekretów w GitHubie);
- artefakty przebiegów (SBOM, wyniki skanów, `release-manifest`) są pobieralne przez każdego zalogowanego użytkownika GitHub — nie zawierają danych ani sekretów (warunek przeglądu zmian w `.github/**`, K3).

## Konsekwencje
- **Pozytywne:** twarda blokada bezpośredniego pushu, force pushu, usunięcia `main` i scalenia bez zielonego `ci-gate` (incydent #106 niemożliwy); zamknięta luka „obejścia złośliwego” tokenem `GITHUB_TOKEN` z ADR-0016; mniej kodu do utrzymania (bez K6, EVM-088, EVM-123); 0 zł; bezpłatne minuty i natywne runnery arm64 (EVM-124 bez QEMU); atestacje pochodzenia dla obrazów.
- **Negatywne / koszty:** kod, dokumentacja bezpieczeństwa i historia są jawne (rozpoznanie dla atakującego); każdy może sforkować repozytorium; wpisy w publicznym logu Sigstore; konfiguracja rulesetu w UI (poza repozytorium) — dowód i przegląd ręczny.
- **Ryzyka i mitygacje:**
  - *PR zmieniający definicję `ci-gate` (workflow z PR) przejdzie wymagany status* → K3 (jawna uwaga Konrada przy `.github/**`), realną granicą zaufania pozostaje przegląd i scalenie PR przez Konrada (ADR-0018); V2/V3 identyfikują przebieg po numerycznym ID workflowu.
  - *Wyłączenie lub zmiana rulesetu przez administratora (konto Konrada)* → MFA (passkey), historia zmian rulesetu; V0 na VM blokuje wdrożenie po `push`/`force_push` na `main` niezależnie od GitHuba; ruleset w przeglądzie dostępów co kwartał (SR-INFRA-09).
  - *Workflowy z forków (koszt, nadużycia, zatrucie cache)* → zatwierdzanie przez Konrada dla wszystkich zewnętrznych kontrybutorów; brak sekretów; brak `pull_request_target`; cache z PR nie trafia do zakresu `main`, a `publish` jest bez cache (ADR-0018).
  - *Sekret w publicznym obrazie GHCR (nieodwracalne po publikacji)* → skan sekretów Trivy wszystkich obrazów przed pushem w `publish` i `publish-infra` (każdy poziom = czerwony, bez wyjątków); decyzja Konrada 2026-11-13 (pkt 3).
  - *Sekret lub dana osobowa w commicie* → gitleaks (hook, CI, cała historia przy przeglądzie), zasada danych syntetycznych; wyciek = rotacja sekretu (historia mogła zostać skopiowana — usunięcie z historii nie wystarcza).
  - Ocena ryzyk (m.in. RR-21 po rulesecie, nowe ryzyko jawności repozytorium) — `security-engineer` w `docs/security/threat-model.md`.

## Plan wyjścia
Powrót do repozytorium prywatnego (zmiana widoczności — minuty): ruleset wymaga wtedy **GitHub Pro** (≈ 15,50 zł/mies.; ADR-0016 opcja B) — bez Pro ochrona `main` wraca do stanu sprzed tej decyzji (K6 do odtworzenia z historii git, ok. 1 dzień z poprawkami z EVM-088/123); atestacje znikają (Enterprise Cloud) — weryfikacja obrazów infrastruktury wraca do digestu i rekordu przebiegu; runnery arm64 w repo prywatnym działają, ale zużywają pulę minut (2 vCPU); wraca próg minut z ADR-0018. Jawności treści sprzed zmiany nie da się cofnąć.

## Weryfikacja
- Posiedzenie A (Konrad, dowód w `docs/ops/github-i-ci.md`): `gh api repos/{o}/{r}/rulesets/{id}` pokazuje reguły z punktu 1 i pustą listę obejść; próba bezpośredniego pushu i force pushu na `main` odrzucona; PR z oczekującym `ci-gate` niescalalny; ustawienie zatwierdzania workflowów z forków.
- EVM-124: pierwsza atestacja obrazu infrastruktury zweryfikowana `gh attestation verify` z `--signer-workflow` i `--source-ref refs/heads/main`.
- Retrospektywa M0/M1 i przegląd kwartalny: ruleset bez zmian, 0 scaleń bez zielonego `ci-gate`, skan sekretów obrazów zielony, gitleaks historii 0.

## Źródła (zweryfikowane 2026-11-12)
- Rulesety — dostępne w repozytoriach publicznych na GitHub Free: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets ; reguły: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Atestacje artefaktów — repozytoria publiczne na wszystkich bieżących planach, prywatne tylko Enterprise Cloud; publiczny Sigstore i log przejrzystości: https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds ; https://github.com/actions/attest-build-provenance
- Runnery arm64 — GA w repo publicznych (2025-08-07), bezpłatne; od 2026-01-29 także w prywatnych (2 vCPU, w puli minut): https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/ , https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories , https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- Widoczność pakietów — domyślnie prywatne, pakiet dziedziczy uprawnienia, nie widoczność repozytorium; upublicznienia nie da się cofnąć: https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
- Zatwierdzanie workflowów z forków: https://docs.github.com/en/actions/how-tos/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks
- Widoczność repozytorium i wynik gitleaks całej historii: Tech Lead, 2026-11-12 (`gh repo view`, gitleaks).
