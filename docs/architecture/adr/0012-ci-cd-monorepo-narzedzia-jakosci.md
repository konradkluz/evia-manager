# ADR-0012: CI/CD, monorepo i narzędzia jakości — GitHub Actions, pnpm + Turborepo, EAS Build dla aplikacji mobilnej

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: devops-engineer, security-engineer)
- **Powiązane:** EVM-001, EVM-005 (lista skanów i progów), EVM-006, EVM-007; ADR-0002, ADR-0004, ADR-0006, ADR-0007, ADR-0011, ADR-0014

## Kontekst i problem
Kod piszą agenci AI, akceptuje jedna osoba — bramki jakości muszą być automatyczne i blokujące (lint, typy, testy, pokrycie z `testing-strategy.md`, skany bezpieczeństwa). Monorepo obejmuje backend, panel web, aplikację mobilną i pakiety współdzielone (kontrakt, sync-core, tokeny). Konrad pracuje na **Windows 11**, więc buildy iOS muszą być **chmurowe**. Wymagania security-engineer: SAST, SCA (podatności i licencje), skan sekretów (pre-commit i CI), skan IaC/kontenerów, akcje przypięte do SHA, bot aktualizacji, ochrona `main`, klucze podpisu tylko w sekretach CI/serwisu buildów z planem rotacji, ocena chmurowego serwisu buildów iOS. Konto repozytorium zdalnego ustalane w EVM-006 (za zgodą Konrada).

## Kryteria decyzji
**Platforma repozytorium i CI**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Koszt (darmowe minuty dla prywatnego repo) | 5 | budżet |
| Integracja repo + CI + ochrona gałęzi | 4 | bramki blokujące merge |
| Bezpieczeństwo (przypinanie akcji, OIDC, sekrety środowisk) | 4 | łańcuch dostaw |
| Znajomość przez agentów (CLI, dokumentacja) | 4 | `gh` używany przez orkiestratora |
| Runnery macOS i wsparcie mobile | 3 | plan wyjścia dla buildów iOS |
| Lokalizacja i podprocesor | 3 | kod i dane syntetyczne, bez danych klientów |

**Serwis buildów mobilnych**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Buildy iOS z Windows (bez Maca) | 5 | warunek Konrada |
| Koszt | 4 | budżet |
| Bezpieczeństwo kluczy podpisu (MFA, DPA, dostęp do kodu) | 4 | security-engineer |
| Integracja z Expo (podpisywanie, wysyłka do sklepów) | 4 | ADR-0007 |
| Prostota | 3 | jedna osoba |

**Narzędzie monorepo**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Prostota konfiguracji | 4 | agenci AI |
| Działanie na Windows i w CI Linux/macOS | 4 | środowisko Konrada |
| Wsparcie Expo / React Native | 4 | aplikacja mobilna |
| Cache i wydajność zadań | 3 | czas CI |

## Rozważane opcje
- **Repo i CI:** **A. GitHub + GitHub Actions** · **B. GitLab.com + GitLab CI** · **C. Codeberg / Forgejo** (UE, własne runnery).
- **Buildy mobilne:** **A. EAS Build + EAS Submit (Expo)** · **B. GitHub Actions z runnerem macOS (`eas build --local` / fastlane)** · **C. Codemagic**.
- **Monorepo:** **A. pnpm workspaces + Turborepo** · **B. Nx** · **C. same pnpm workspaces**.

## Ocena
**Repo i CI**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Koszt (5) | 5 | 4 | 4 |
| Integracja i ochrona gałęzi (4) | 5 | 4 | 3 |
| Bezpieczeństwo (4) | 4 | 4 | 3 |
| Znajomość przez agentów (4) | 5 | 4 | 2 |
| Runnery macOS (3) | 4 | 3 | 1 |
| Lokalizacja i podprocesor (3) | 3 | 3 | 5 |
| **Suma ważona (maks. 115)** | **102** | **86** | **70** |

**Buildy mobilne**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Buildy iOS z Windows (5) | 5 | 5 | 5 |
| Koszt (4) | 5 | 3 | 4 |
| Bezpieczeństwo kluczy (4) | 4 | 5 | 4 |
| Integracja z Expo (4) | 5 | 3 | 3 |
| Prostota (3) | 5 | 2 | 4 |
| **Suma ważona (maks. 100)** | **96** | **75** | **81** |

**Monorepo**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Prostota (4) | 5 | 3 | 5 |
| Windows i CI (4) | 5 | 4 | 5 |
| Expo / React Native (4) | 4 | 4 | 4 |
| Cache i wydajność (3) | 4 | 5 | 2 |
| **Suma ważona (maks. 75)** | **68** | **59** | **62** |

Uwagi: **na GitHub Free gałęzie chronione i rulesety nie są egzekwowane w repozytoriach prywatnych** (wymagają GitHub Pro, Team lub Enterprise), a reguły wdrożeń środowisk (deployment branches) w repo prywatnym wymagają Pro/Team; **wymagani recenzenci środowiska** w repo prywatnym są dostępni tylko w GitHub Enterprise. GitHub Pro (4 USD/mies.) zawiera 3000 min/mies. Actions; GitHub Free daje 2000 min/mies. dla prywatnych repozytoriów (cennik od 2026-01-01; planowana opłata za runnery self-hosted została wycofana); runner macOS 0,062 USD/min. EAS Free: 15 buildów iOS + 15 Android/mies. (kolejka niskiego priorytetu); Starter 19 USD/mies. Codemagic: 500 min macOS/mies. za darmo. typescript-eslint 8.71 wspiera TypeScript `< 6.1` — dlatego lint z regułami typów działa na TS 6.0; natywny TS 7 (tsgo) tylko jako opcjonalne szybkie sprawdzanie typów. Wersje i ceny zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**Repozytorium i CI:** prywatne repo na **GitHub** na planie **GitHub Pro** dla konta osobistego Konrada (4 USD/mies. ≈ 15,50 zł; 3000 min Actions) **albo GitHub Team** dla organizacji (4 USD/użytkownika/mies.) — wybór konta w EVM-006, za zgodą Konrada. Plan płatny jest **wymagany**, bo bez niego ochrona `main` w repo prywatnym nie jest egzekwowana i bramki byłyby tylko umowne. **GitHub Actions** (runnery Linux; macOS tylko awaryjnie).

**Monorepo:** **pnpm workspaces + Turborepo** (cache zadań). Struktura (do potwierdzenia w EVM-006): `apps/api` (API + worker), `apps/web`, `apps/mobile`, `services/media-processor`, `packages/contracts` (OpenAPI + generowane typy, Zod, klient), `packages/sync-core`, `packages/ui-web`, `packages/tokens` (z `design/tokens/`), `packages/config` (ESLint, TS, Vitest), `infra/` (OpenTofu, Compose).

**Narzędzia jakości (bramka lokalna i CI — jedna komenda, EVM-006):**
- Formatowanie **Prettier**; lint **ESLint 10 + typescript-eslint** (reguły z typami, zakaz `any` i konkatenacji SQL, reguły tokenów dla UI); granice modułów **dependency-cruiser** (ADR-0001).
- Typy: **TypeScript 6.0** w trybie `strict` (zgodny z typescript-eslint); TS 7 (natywny) opcjonalnie do szybkiego `typecheck` w CI, gdy narzędzia go obsłużą.
- Testy i pokrycie wg ADR-0014; progi i pokrycie zmienionego kodu (≥ 90%) jako bramka blokująca.
- Kontrakt: Redocly lint, oasdiff (zmiany łamiące), regeneracja klientów bez różnic (ADR-0004).
- Hooki git: **lefthook** (pre-commit: format, lint zmienionych plików, **gitleaks**).

**Skany bezpieczeństwa (lista i progi finalizuje EVM-005):**
| Obszar | Narzędzie | Kiedy |
|---|---|---|
| SAST | **Semgrep CE** (reguły TS/JS, Node, React; CodeQL dla prywatnych repo wymaga płatnej licencji GitHub) | każdy PR |
| SCA — podatności | **OSV-Scanner** + `pnpm audit` | każdy PR + codziennie |
| SCA — licencje | **Trivy** (skan licencji) z listą dozwolonych (MIT, Apache-2.0, BSD, ISC, MPL-2.0 …; AGPL/GPL tylko narzędzia nieredystrybuowane) | każdy PR |
| Sekrety | **gitleaks** (pre-commit i CI, pełna historia przy pierwszym uruchomieniu) | każdy commit/PR |
| IaC i kontenery | **Trivy** (konfiguracja OpenTofu/Compose/Dockerfile, obrazy) | każdy PR + przed wdrożeniem |
| DAST | **ZAP baseline** — wyłącznie na staging (ADR-0014) | po wdrożeniu na staging, przed wydaniem |

**Łańcuch dostaw i CI:**
- Wszystkie akcje GitHub **przypięte do SHA**; uprawnienia `GITHUB_TOKEN` minimalne (`contents: read` domyślnie); wdrożenia przez OIDC lub sekrety środowisk; brak sekretów w logach.
- **Renovate** uruchamiany jako GitHub Action (bez zewnętrznej aplikacji): grupowanie aktualizacji (np. Expo SDK, NestJS, narzędzia testowe), przypinanie digestów obrazów i SHA akcji, okres karencji nowych wersji (np. 3 dni) przeciw atakom na łańcuch dostaw.
- `pnpm` z lockfile (`--frozen-lockfile` w CI) i listą pakietów z dozwolonymi skryptami instalacyjnymi.
- **Ochrona `main` (ruleset, egzekwowany na planie Pro/Team):** tylko przez PR, wymagane zielone checki (wszystkie bramki jakości i bezpieczeństwa), zakaz bezpośredniego pushu, force-push i usuwania, historia liniowa (squash merge), **bez listy obejść (bypass) — także dla administratora**; merge wyłącznie po akceptacji Konrada. Tokeny agentów i CI bez uprawnień administracyjnych do repo (nie mogą zmienić rulesetu).

**Wdrożenia:** obrazy kontenerów budowane w CI → prywatny rejestr (GHCR) → staging automatycznie po merge do `main`, prod po ręcznym zatwierdzeniu przez Konrada. Mechanizm (dostępny w Pro/Team; wymagani recenzenci środowiska w repo prywatnym wymagają Enterprise, więc ich nie używamy): workflow **`workflow_dispatch`** wyzwalany ręcznie przez Konrada, wdrażający niezmienny obraz (digest) już przetestowany na staging; job w środowisku `production` z **deployment branches ograniczonymi do `main`**; sekrety produkcyjne wyłącznie jako sekrety tego środowiska; warunek w workflow `github.actor` = konto Konrada (inne wyzwolenia odrzucane). Ryzyko rezydualne: przejęcie konta Konrada lub tokenu z prawem `actions: write` pozwala wyzwolić wdrożenie — mitygacja: MFA, tokeny agentów bez `actions: write`, alert e-mail o każdym wdrożeniu prod (EVM-007). Migracje bazy jako osobny krok przed startem nowej wersji (ADR-0003).

**Aplikacja mobilna:** **EAS Build** (iOS na chmurowych maszynach macOS, Android), **EAS Submit** do TestFlight i ścieżki testów wewnętrznych Google Play. Ocena serwisu buildów iOS (security-engineer):
- *Dostęp do kodu:* EAS otrzymuje kod aplikacji mobilnej (bez danych klientów, bez sekretów serwerowych — w buildzie tylko publiczna konfiguracja, np. adres API).
- *Klucze podpisu:* certyfikat dystrybucyjny i profil iOS oraz keystore Androida przechowywane **wyłącznie** w EAS (szyfrowane) lub w sekretach CI; Android z **Play App Signing** (klucz wydania u Google, u nas tylko klucz uploadu — możliwy reset po wycieku). **Plan rotacji:** certyfikat iOS co rok (ważność) oraz natychmiast po odejściu osoby z dostępem lub podejrzeniu wycieku; klucz uploadu Androida — reset przez Play Console przy incydencie; klucze App Store Connect API rotowane co 12 miesięcy.
- *MFA:* obowiązkowe na kontach Expo, Apple ID i Google; minimum osób z dostępem.
- *DPA:* Expo udostępnia DPA na żądanie (podmiot z USA, brak danych klientów — ADR-0011); raport SOC 2 Type 2 dopiero w planie Production — akceptowalne, bo build nie zawiera danych osobowych.
- *Wyjście:* `eas build --local` na runnerze macOS GitHub Actions lub Codemagic, klucze w sekretach CI.

## Konsekwencje
- **Pozytywne:** niski koszt CI w MVP (GitHub Pro ≈ 15,50 zł/mies., minuty w cenie); ochrona `main` faktycznie egzekwowana; buildy iOS z Windows; blokujące bramki jakości i bezpieczeństwa od pierwszego commita; dobrze znane agentom narzędzia (`gh`, Actions).
- **Negatywne / koszty:** limit 3000 min/mies. (Pro) wymaga cache Turborepo i selektywnego uruchamiania; kolejka EAS Free bywa długa (90+ min); GitHub i Expo to podmioty z USA (tylko kod i dane syntetyczne).
- **Ryzyka i mitygacje:**
  - *Wyciek kluczy podpisu* → przechowywanie wyłącznie w EAS/sekretach, MFA, Play App Signing, plan rotacji.
  - *Skompromitowana akcja/zależność* → przypięte SHA, karencja Renovate, SCA, minimalne uprawnienia tokenów.
  - *Przekroczenie minut w cenie planu* → monitorowanie zużycia, cache; runner self-hosted na VM staging jako opcja.
  - *Obejście bramek (bezpośredni push do `main`, merge mimo czerwonych checków)* → plan Pro/Team z rulesetem bez bypassu; test w EVM-006.

## Plan wyjścia
Workflowy to YAML z wywołaniami komend pnpm/Turborepo — przeniesienie na GitLab CI lub Forgejo Actions to dni pracy. Buildy mobilne: `eas build --local` na dowolnym macOS (GitHub, Codemagic). Turborepo można usunąć bez zmian w kodzie (zostają skrypty pnpm).

## Weryfikacja
- EVM-006: celowo wprowadzony sekret, podatna zależność i niepokryty kod dają czerwoną bramkę; ochrona `main` aktywna — **próba bezpośredniego pushu do `main` (także z konta administratora) zostaje odrzucona**, a PR z czerwonym checkiem nie da się scalić.
- EVM-007: wdrożenie prod wyzwolone z gałęzi innej niż `main` lub przez inne konto niż Konrada jest odrzucane.
- EVM-009: build iOS z EAS zainstalowany na iPhonie przez TestFlight lub dystrybucję wewnętrzną.
- Miesięcznie: zużycie minut CI i buildów EAS vs limity.

## Źródła (zweryfikowane 2026-10-02)
- GitHub Actions — cennik 2026 (2000 min Free, macOS 0,062 USD/min, wycofana opłata za self-hosted): https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions , https://samexpert.com/github-actions-pricing-backlash-2026/
- GitHub — ochrona gałęzi i rulesety (repo prywatne: Pro, Team, Enterprise): https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches , plany: https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- GitHub — środowiska (wymagani recenzenci w repo prywatnym tylko Enterprise; deployment branches w Pro/Team): https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- EAS — cennik i 2FA: https://expo.dev/pricing ; GDPR/DPA Expo: https://docs.expo.dev/regulatory-compliance/gdpr/
- Codemagic — cennik (500 min macOS M2 za darmo, 0,095 USD/min): https://codemagic.io/pricing/
- pnpm 12.8.1, Turborepo 2.11.7 (MIT): https://github.com/pnpm/pnpm/releases , https://www.npmjs.com/package/turbo
- TypeScript 6.0.3 (2026-04-16) i 7.0.2 (2026-07-08); typescript-eslint 8.71.0 (peer `typescript >=4.8.4 <6.1.0`): https://www.npmjs.com/package/typescript , https://www.npmjs.com/package/typescript-eslint ; licencje (zweryfikowane 2026-10-02): TypeScript **Apache-2.0** (https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt), typescript-eslint **MIT** (https://github.com/typescript-eslint/typescript-eslint/blob/main/LICENSE)
- ESLint 10.11.0, Prettier 3.9.9, dependency-cruiser 18.5.0, lefthook 2.1.16 (MIT): https://www.npmjs.com/package/eslint , https://www.npmjs.com/package/prettier , https://www.npmjs.com/package/lefthook
- Semgrep 1.179.0 (2026-10-02): https://github.com/semgrep/semgrep/releases ; OSV-Scanner 2.6.0: https://github.com/google/osv-scanner/releases ; Trivy 0.75.0: https://github.com/aquasecurity/trivy/releases ; gitleaks 8.30.1: https://github.com/gitleaks/gitleaks/releases ; Renovate 44.132.2: https://github.com/renovatebot/renovate/releases ; ZAP 2.17.0: https://github.com/zaproxy/zaproxy/releases
- Licencje narzędzi CI (zweryfikowane 2026-10-02):
  - Semgrep CE (silnik) — **LGPL-2.1**: https://github.com/semgrep/semgrep/blob/develop/LICENSE ; reguły z rejestru Semgrep — **Semgrep Rules License v1.0** (dozwolone wyłącznie wewnętrzne użycie biznesowe, np. skan własnego kodu; zakaz redystrybucji i oferowania jako usługi — nasze użycie w CI jest zgodne): https://semgrep.dev/legal/rules-license
  - OSV-Scanner — **Apache-2.0**: https://github.com/google/osv-scanner/blob/main/LICENSE ; Trivy — **Apache-2.0**: https://github.com/aquasecurity/trivy/blob/main/LICENSE ; gitleaks — **MIT**: https://github.com/gitleaks/gitleaks/blob/master/LICENSE ; ZAP — **Apache-2.0**: https://github.com/zaproxy/zaproxy/blob/main/LICENSE
  - Renovate — **AGPL-3.0**: https://github.com/renovatebot/renovate/blob/main/license — uruchamiany jako GitHub Action, niemodyfikowany i niedystrybuowany; AGPL nie obejmuje kodu systemu (zgodnie z polityką licencji w tabeli bramek: AGPL/GPL tylko dla narzędzi nieredystrybuowanych).
- Google Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756
