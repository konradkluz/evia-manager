# Obrazy kontenerów — licencje komponentów zewnętrznych i dostęp do źródeł

> **Notice (EN).** The public container images `ghcr.io/konradkluz/evia-api`, `evia-web`, `evia-postgres-pgbackrest` and `evia-media-processor` contain third-party software, including components licensed under the GNU GPL and LGPL (e.g. FFmpeg built by Debian with GPL options, libvips as prebuilt by sharp, glibc, BusyBox). These components are unmodified binaries from Debian 13, Alpine 3.24, the official upstream base images and the npm registry. The exact versions are recorded inside each image (package databases listed below) and in its SBOM. The corresponding source code is available from the locations listed below. **Written offer:** for at least three years after we last published a given image version, we will give any third party, on request and at no charge beyond the cost of physically performing the distribution, a complete machine-readable copy of the corresponding source code of the GPL/LGPL components in that version. Requests: see „Oferta źródeł” below.

Dokument żywy (EVM-124; ADR-0022 pkt 3 — pakiety GHCR publiczne, decyzja Konrada 2026-11-13). Właściciel: `security-engineer` (treść), `devops-engineer` (zgodność z `Dockerfile`). Każdy obraz wskazuje ten plik etykietą `org.opencontainers.image.documentation`. Publiczny obraz = redystrybucja: obowiązki licencji GPL i LGPL (informacja, teksty licencji, dostęp do źródeł) spełniamy tym dokumentem, bez zmiany obrazów i bez własnego lustra źródeł.

## Co zawierają obrazy

| Obraz | Baza (po digeście w `Dockerfile`) | Komponenty copyleft (przykłady, niepełna lista) | Pozostałe |
|---|---|---|---|
| `evia-api` | `gcr.io/distroless/nodejs26-debian13` | Debian 13: `libc6` (glibc, LGPL-2.1-or-later), `libgcc`/`libstdc++` (GPL-3.0 z GCC Runtime Library Exception), `ca-certificates` (MPL-2.0) | Node.js (MIT i biblioteki dołączone); zależności npm — wyłącznie licencje z listy dozwolonych bramki 4 (permisywne) oraz `nodemailer` (MIT-0) |
| `evia-web` | `caddy:2.11.9-alpine` | Alpine 3.24: `busybox`, `apk-tools`, `alpine-baselayout`, `scanelf` (GPL-2.0-only), `libidn2`, `libunistring` (GPL-2.0-or-later / LGPL-3.0-or-later), `ca-certificates` (MPL-2.0) | Caddy (Apache-2.0); paczka panelu — licencje permisywne (bramka 4) |
| `evia-postgres-pgbackrest` | `postgres:18.6-trixie` | Debian 13: m.in. `bash`, `coreutils`, `libc6` (GPL/LGPL) | PostgreSQL (PostgreSQL License), pgBackRest (MIT, `apt.postgresql.org`) |
| `evia-media-processor` | `node:26.13.1-trixie-slim` | Debian 13: `ffmpeg` w wersji z `FFMPEG_VERSION` w `Dockerfile` (kompilacja Debiana z opcjami GPL — całość na GPL, wersja licencji: `ffmpeg -L`; m.in. `libx264`, `libx265`, `libpostproc`) i jego biblioteki (GPL/LGPL); `@img/sharp-libvips-linux-arm64` w wersji z `pnpm-lock.yaml`: libvips (LGPL-3.0-or-later) z dołączonymi bibliotekami (m.in. glib, libexif, librsvg, pango, cairo — LGPL-2.1-or-later; libheif — LGPL-3.0) | sharp (Apache-2.0); kod usługi z tego repozytorium |

Wszystkie komponenty są **niezmodyfikowane**. ffmpeg i ffprobe działają jako osobne programy (proces potomny), a libvips jest biblioteką współdzieloną ładowaną dynamicznie przez sharp — można ją podmienić na inną wersję, budując obraz pochodny (LGPL-3.0 §4).

**Dokładne wersje** (źródło prawdy to obraz pod danym digestem): Debian — `/var/lib/dpkg/status` (w `evia-api`, bazie distroless: `/var/lib/dpkg/status.d/`); Alpine — `/lib/apk/db/installed`; npm — `node_modules/<pakiet>/package.json` i `versions.json` w pakiecie `@img/sharp-libvips-*`. Ten sam spis daje SBOM: `trivy image --format cyclonedx <obraz>@<digest>` albo artefakty `sbom` i `infra-images-evidence` przebiegu CI (90 dni).

**Teksty licencji:** obrazy na Debianie — `/usr/share/common-licenses/` (GPL-2, GPL-3, LGPL-2.1, LGPL-3) i `/usr/share/doc/<pakiet>/copyright`; pakiety npm — plik `LICENSE` i `README.md` pakietu; Alpine i pozostałe — https://www.gnu.org/licenses/ oraz https://www.mozilla.org/MPL/2.0/.

## Gdzie są źródła

| Komponent | Źródło odpowiadające binariom |
|---|---|
| Pakiety Debiana (w tym `ffmpeg`) | https://snapshot.debian.org/ — pakiet źródłowy w dokładnej wersji z bazy pakietów obrazu (`apt-get source <pakiet>=<wersja>` przy wpisie snapshot w `sources.list`) |
| Pakiety Alpine | https://gitlab.alpinelinux.org/alpine/aports (gałąź `3.24-stable`, `APKBUILD` i łatki pakietu) oraz archiwa źródeł z https://distfiles.alpinelinux.org/distfiles/ |
| libvips i biblioteki dołączone przez sharp | https://github.com/lovell/sharp-libvips (tag `v<wersja pakietu @img/sharp-libvips-*>`: skrypty budowy i wersje bibliotek z `versions.json`) oraz źródła upstream wymienione w `README.md` pakietu (libvips: https://github.com/libvips/libvips/releases) |
| Obrazy bazowe | distroless: https://github.com/GoogleContainerTools/distroless · Node.js: https://github.com/nodejs/docker-node · PostgreSQL: https://github.com/docker-library/postgres · Caddy: https://github.com/caddyserver/caddy-docker |
| Kod EVia Manager i pliki budowy | to repozytorium, commit z rekordu wydania (`release-manifest`, `infra-images-record`) |

## Oferta źródeł

Na prośbę dowolnej osoby, przez co najmniej 3 lata od ostatniej publikacji danej wersji obrazu, przekazujemy komplet źródeł komponentów GPL i LGPL tej wersji, bezpłatnie (GPL-2.0 §3(b), GPL-3.0 §6, LGPL). Zgłoszenia (z nazwą obrazu i digestem): **kontakt@eviacharge.pl**.

Realizacja (rzadka, ok. 1–2 h, właściciel `devops-engineer`): z obrazu pod podanym digestem odczytaj wersje pakietów (ścieżki wyżej), pobierz pakiety źródłowe z https://snapshot.debian.org/ albo z aports i distfiles Alpine oraz źródła sharp-libvips i bibliotek upstream dla wersji z `versions.json`, spakuj i udostępnij odbiorcy (link do pobrania). Usunięcie wersji obrazu z GHCR (retencja) nie skraca 3 lat dla wersji już opublikowanych.

## Zmiany obrazów
Nowy komponent copyleft albo nowy obraz publiczny = aktualizacja tabel w tym pliku w tym samym PR (przegląd `security-engineer`). Nowa licencja zależności npm przechodzi bramkę 4 (`docs/security/requirements.md`); wyjątek licencji w `.trivyignore.yaml` dla komponentu publicznego obrazu wskazuje ten plik.
