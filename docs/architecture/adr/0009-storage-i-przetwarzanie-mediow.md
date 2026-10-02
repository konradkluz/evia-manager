# ADR-0009: Storage i przetwarzanie mediów — Scaleway Object Storage (Warszawa), S3 multipart z podpisanymi URL-ami, skan AV i izolowane przetwarzanie

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: mobile-developer, security-engineer)
- **Powiązane:** EVM-001, EVM-002 (`media-pipeline.md`), EVM-005 (EXIF/GPS, retencja), EVM-011, E6, E11; ADR-0003, ADR-0004, ADR-0007, ADR-0008, ADR-0010, ADR-0011, ADR-0013

## Kontekst i problem
Archiwum zdjęć, filmów i dokumentów: ok. 500 GB w MVP, ok. 3 TB po 2 latach, lata retencji, „0 utraconych plików”. Pliki trafiają z telefonów (upload w tle, ADR-0007) i z panelu web. Każdy plik z zewnątrz jest potencjalnie złośliwy (exploit w ffmpeg/libvips, podmiana typu, XSS przez dokument). Wymagania security-engineer: prywatny bucket z SSE w UE, krótkie podpisane URL-e po autoryzacji, klucze nadawane przez serwer, typ po zawartości, skan AV z kwarantanną, izolowane przetwarzanie, wersjonowanie/object lock, lifecycle, audyt i limity masowych pobrań, wyceniony backup poza głównym miejscem. Trzy decyzje: **dostawca storage'u**, **protokół uploadu**, **przetwarzanie**.

## Kryteria decyzji
**Dostawca storage'u**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Bezpieczeństwo: SSE zgodne z podpisanymi URL-ami, polityki bucketu, object lock, IAM | 5 | baseline, ASVS V5/V14 |
| Firma i region w UE, DPA | 5 | RODO, brak CLOUD Act |
| Koszt przy 0,5–3 TB i ruchu wychodzącym | 5 | budżet; storage dominuje koszty po 2 latach |
| Zgodność z S3 (multipart, presigned, lifecycle, wersjonowanie) | 4 | standardowe SDK, plan wyjścia |
| Trwałość (wiele stref dostępności) | 4 | „0 utraconych plików” |
| Bliskość użytkowników (Polska) | 2 | szybkość uploadu z telefonów |

**Protokół uploadu**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Wznawialność dużych plików | 5 | filmy do 4 GB, słaby zasięg |
| Zgodność z uploadem w tle iOS/Android (zadania z pliku) | 5 | ADR-0007 |
| Bezpieczeństwo (serwer nadaje klucz, rozmiar, typ; brak publicznego zapisu) | 4 | CWE-434 |
| Prostota | 4 | utrzymanie |
| Koszt (ruch nie przechodzi przez VM) | 3 | transfer i CPU |

**Przetwarzanie (miniatury, podglądy, skan)**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Bezpieczeństwo, izolacja i RODO (dane nie opuszczają naszej infrastruktury) | 5 | CWE-400, CVE w parserach |
| Koszt | 4 | budżet |
| Kontrola i elastyczność (EXIF/GPS, formaty) | 3 | polityka z EVM-005 |
| Prostota | 3 | utrzymanie |

## Rozważane opcje
- **Storage:** **A. Scaleway Object Storage, region `pl-waw` (Warszawa), Standard Multi-AZ** · **B. Hetzner Object Storage** · **C. OVHcloud Object Storage** · **D. AWS S3 `eu-central-1`**.
- **Upload:** **A. S3 multipart z podpisanymi URL-ami części** (bezpośrednio do bucketu) · **B. tus przez własny serwer (tusd)** · **C. pojedynczy podpisany PUT** · **D. upload przez API (proxy)**.
- **Przetwarzanie:** **A. własny worker: ClamAV + sharp (libvips) + ffmpeg w izolowanych kontenerach** · **B. SaaS mediów (np. Cloudinary, Mux)** · **C. tylko na urządzeniu** (bez przetwarzania serwerowego).

## Ocena
**Storage**
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Bezpieczeństwo (5) | 5 | 2 | 4 | 5 |
| Firma i region w UE, DPA (5) | 5 | 5 | 5 | 2 |
| Koszt (5) | 4 | 5 | 3 | 2 |
| Zgodność z S3 (4) | 5 | 4 | 5 | 5 |
| Trwałość (4) | 5 | 3 | 5 | 5 |
| Bliskość użytkowników (2) | 5 | 3 | 4 | 3 |
| **Suma ważona (maks. 125)** | **120** | **94** | **108** | **91** |

**Upload**
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Wznawialność (5) | 5 | 5 | 1 | 2 |
| Upload w tle (5) | 5 | 3 | 4 | 3 |
| Bezpieczeństwo (4) | 4 | 4 | 4 | 3 |
| Prostota (4) | 4 | 3 | 5 | 4 |
| Koszt (3) | 5 | 3 | 5 | 2 |
| **Suma ważona (maks. 105)** | **97** | **77** | **76** | **59** |

**Przetwarzanie**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Bezpieczeństwo, izolacja, RODO (5) | 4 | 2 | 3 |
| Koszt (4) | 5 | 1 | 5 |
| Kontrola i elastyczność (3) | 5 | 3 | 2 |
| Prostota (3) | 3 | 5 | 4 |
| **Suma ważona (maks. 75)** | **64** | **38** | **53** |

Uwagi: **B (Hetzner)** jest najtańszy, ale nie ma domyślnego szyfrowania w spoczynku — jedyną opcją jest SSE-C (klucz klienta w nagłówkach), niezgodne z podpisanymi URL-ami dla telefonów i przeglądarki; dane w jednym centrum danych. Nadaje się za to na **kopię zapasową** z szyfrowaniem po stronie klienta (ADR-0011). **A (Scaleway)**: francuska spółka z UE, region w Warszawie, Standard Multi-AZ (3 strefy), szyfrowanie bucketu SSE-ONE (klucze zarządzane), SSE-KMS, object lock, lifecycle do klasy Glacier, żądania bez opłat, 75 GB transferu wychodzącego/mies. bez opłat. **D**: podmiot z USA (CLOUD Act), wyższe ceny transferu. Przetwarzanie SaaS (B) wysyła dane klientów do podmiotów spoza UE i kosztuje wielokrotność budżetu; przetwarzanie tylko na urządzeniu (C) nie obejmuje uploadów z przeglądarki i nie zastępuje skanu AV. Ceny i funkcje zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**Storage:** **Scaleway Object Storage, `pl-waw`, klasa Standard Multi-AZ**; osobne buckety i klucze dostępu per środowisko (staging/prod), osobny bucket na backupy bazy (ADR-0003).
- **Prywatny bucket z blokadą publicznego dostępu:** brak publicznych ACL; polityka bucketu dopuszcza wyłącznie nasze klucze aplikacyjne (Deny dla pozostałych); test w CI/IaC sprawdza, że anonimowy `GET` zwraca 403.
- **Szyfrowanie:** domyślne szyfrowanie bucketu **SSE-ONE** (AES-256, klucze zarządzane przez dostawcę); dostawca w UE z **DPA**.
- **Wersjonowanie + object lock (tryb governance, retencja 30 dni)** — ochrona przed ransomware i przypadkowym usunięciem; usunięcie przez aplikację tworzy znacznik usunięcia, stare wersje wygasają po 30 dniach (zgodność z prawem do usunięcia danych — EVM-005).
- **Klucze dostępu** wg najmniejszych uprawnień: API (wystawianie podpisanych URL-i), worker (odczyt oryginałów, zapis pochodnych), backup (tylko odczyt).

**Upload: S3 multipart z podpisanymi URL-ami części (V5, CWE-434):**
1. Klient tworzy metadane `MediaAsset` (synchronizacja, ADR-0008) i prosi o sesję uploadu, deklarując rozmiar, typ i SHA-256.
2. Serwer **autoryzuje obiekt** (czy użytkownik może dodawać media do tego zlecenia), sprawdza limity i dozwolone typy, **sam generuje klucz obiektu** (`media/{rok}/{miesiąc}/{assetId}/original` — nigdy z nazwy pliku; oryginalna nazwa tylko w metadanych), tworzy multipart upload z typem zawartości nadanym przez serwer i zwraca partię **podpisanych URL-i części** (TTL **60 min**, każdy związany z kluczem, `uploadId`, numerem części i rozmiarem).
3. Klient wysyła części bezpośrednio do storage'u; po wygaśnięciu URL-i pobiera nowe (po ponownej autoryzacji sesji i urządzenia).
4. `complete`: serwer składa obiekt, weryfikuje łączny rozmiar względem deklaracji (przekroczenie → usunięcie i odrzucenie), ustawia stan `uploaded` i zleca skan. Niedokończone uploady usuwa lifecycle po 7 dniach.
Panel web używa tego samego przepływu (biblioteka JS w przeglądarce).

**Limity i walidacja typu:** zdjęcia ≤ **50 MB** (JPEG, HEIC, PNG, WebP), wideo ≤ **4 GB** i ≤ **30 min** (MP4/MOV, H.264/HEVC), dokumenty ≤ **100 MB** (PDF, DOCX, XLSX, skany JPG/PNG) — lista dozwolonych. **Typ weryfikowany po zawartości** (magic bytes, `file-type`) i przez parsowanie (sharp/ffprobe); niezgodność → kwarantanna. Aplikacja mobilna nagrywa 1080p z ograniczonym bitrate (~10 Mb/s → 30 min ≈ 2,3 GB), co ogranicza koszt storage'u.

**Stany i kwarantanna:** `pending_upload → uploaded → scanning → clean → processing → ready`; `quarantined` (wynik AV lub niezgodny typ: **plik niedostępny do pobrania**, alert do Administratora, usunięcie po 30 dniach), `failed` (ponowienie). Do czasu przejścia skanu plik nie jest dostępny dla nikogo.

**Skan AV:** **ClamAV** (linia LTS 1.4 lub aktualna 1.5) jako `clamd` w kontenerze **bez sieci** (gniazdo Unix na współdzielonym wolumenie); aktualizacje sygnatur przez osobny kontener `freshclam` z ruchem wyłącznie do mirrorów ClamAV; alert, gdy sygnatury starsze niż 24 h. Wymaga ok. 1,2 GB RAM (do 2,4 GB przy przeładowaniu — ustawiamy przeładowanie nierównoległe), co jest uwzględnione w rozmiarze VM i kosztach (ADR-0011). Limit rozmiaru skanowanego pliku dla bardzo dużych filmów — do weryfikacji w EVM-005/EVM-011; dla plików ponad limit: walidacja strukturalna (ffprobe) i udostępnianie w przeglądarce wyłącznie pochodnej transkodowanej, oryginał tylko jako załącznik.

**Przetwarzanie w izolacji (CWE-400):** kontener `media-processor` z **sharp (libvips)** i **ffmpeg**: `network_mode: none`, system plików tylko do odczytu + `tmpfs`, `cap_drop: ALL`, `no-new-privileges`, użytkownik nie-root, limity **pamięci (1,5 GB), CPU (2), liczby procesów** i **czasu** (zdjęcie 60 s, wideo 15 min). Worker (ADR-0010) pobiera obiekt ze storage'u, przekazuje plik przez współdzielony wolumen i gniazdo Unix, odbiera wynik i zapisuje pochodne. Pochodne: miniatury WebP 320 px i 1600 px (z korekcją orientacji), klatka podglądu i **podgląd wideo 720p H.264** (odtwarzalny w każdej przeglądarce). **Pipeline usuwa EXIF/GPS** z pochodnych zawsze, a z oryginałów — jeśli tak zdecyduje polityka w EVM-005. Obrazy kontenerów przypięte, skanowane (Trivy) i aktualizowane przez Renovate (ADR-0012).

**Pobieranie:** API autoryzuje obiekt, zapisuje audyt (oryginały i dokumenty) i wystawia **podpisany GET z TTL ≤ 5 min**. Dokumenty i oryginały z `Content-Disposition: attachment` (nazwa w `filename*` UTF-8, oczyszczona); inline tylko pochodne o stałym, bezpiecznym typie. Pliki serwowane **bezpośrednio z domeny bucketu** (inny origin niż aplikacja — brak XSS w kontekście aplikacji).

**Masowe pobrania:** eksport ZIP jako zadanie w tle z audytem i limitem (np. 1 eksport / 10 min / użytkownik, limit rozmiaru); limit wystawiania podpisanych URL-i per użytkownik (np. 300 / 10 min) i **alert** przy przekroczeniu progu (ADR-0013).

**Lifecycle i retencja:** usuwanie niedokończonych uploadów (7 dni), wygasanie starych wersji (30 dni), usuwanie kwarantanny (30 dni); opcjonalnie przenoszenie **oryginałów wideo starszych niż 12 miesięcy do klasy Glacier** (6× taniej, odtworzenie w godzinach; podglądy zostają w klasie standardowej) — decyzja Konrada (pytanie w `../README.md`). Okresy retencji dokumentacji — EVM-005.

**Backup mediów poza głównym miejscem (jawnie wyceniony w `../README.md`):** codzienny `rclone sync` do **Hetzner Storage Box** (inny dostawca, Finlandia) z **szyfrowaniem po stronie klienta** (`rclone crypt`, klucze w sekretach) i automatycznymi snapshotami Storage Boxa (ochrona przed usunięciem z przejętego serwera). RPO mediów ≤ 24 h dla awarii dostawcy; przypadkowe usunięcie — z wersjonowania (30 dni).

## Konsekwencje
- **Pozytywne:** pliki nie obciążają API ani VM; wznawialny upload zgodny z mechanizmami systemowymi; dane w Polsce/UE; skan i przetwarzanie pod naszą kontrolą; standard S3 = łatwa zmiana dostawcy.
- **Negatywne / koszty:** storage jest największą pozycją kosztów po 2 latach (`../README.md`); ClamAV wymaga VM z 8 GB RAM; własny pipeline do utrzymania (aktualizacje ffmpeg/libvips).
- **Ryzyka i mitygacje:**
  - *Wyciek podpisanego URL-a* → TTL ≤ 5 min, podpis per obiekt, audyt pobrań, brak list obiektów.
  - *Exploit w parserze mediów* → izolacja bez sieci, limity, szybkie aktualizacje obrazów.
  - *Koszt 3 TB* → lifecycle do Glacier, limit bitrate na urządzeniu, alerty budżetowe.
  - *Rozjazd stanu bazy i storage'u* → okresowe zadanie uzgadniające (obiekty bez rekordu, rekordy bez obiektu) z alertem.

## Plan wyjścia
API S3 jest standardem: zmiana dostawcy (np. OVHcloud, AWS) = `rclone sync` bucketu (koszt transferu wychodzącego ~0,01 EUR/GB → 3 TB ≈ 30 EUR) i zmiana endpointu/kluczy w konfiguracji. Brak zależności od funkcji specyficznych dla Scaleway poza SSE-ONE (zastępowalne SSE-S3/SSE-KMS u innego dostawcy).

## Weryfikacja
- EVM-011: upload multipart z telefonu do bucketu staging, zgodne sumy kontrolne, brak duplikatów.
- EVM-007: test „anonimowy GET = 403”, alert przy plikach w kwarantannie, raport z backupu mediów i test odtworzenia pojedynczego pliku.
- M1/M2: plik EICAR trafia do kwarantanny (test E2E); podpisany URL po 5 min zwraca 403.

## Źródła (zweryfikowane 2026-10-02)
- Scaleway — cennik storage'u (Multi-AZ 0,01606 EUR/GB/mies., One Zone 0,00803, Glacier 0,00254; 75 GB transferu bez opłat, potem 0,01 EUR/GB; żądania w cenie): https://www.scaleway.com/en/pricing/storage/
- Scaleway — klasy i regiony (Multi-AZ w `pl-waw`): https://www.scaleway.com/en/docs/object-storage/concepts/ ; SSE-ONE: https://www.scaleway.com/en/docs/object-storage/how-to/enable-sse-one/ ; FAQ (object lock, lifecycle): https://www.scaleway.com/en/docs/object-storage/faq/
- Hetzner Object Storage — brak domyślnego szyfrowania, tylko SSE-C: https://docs.hetzner.com/storage/object-storage/faq/general/ , https://docs.hetzner.com/storage/object-storage/howto-protect-objects/encrypt-with-sse-c/
- OVHcloud Object Storage — cennik: https://www.ovhcloud.com/en/public-cloud/prices/
- ClamAV 1.5.4 (2026-08-07), 1.4 LTS (wsparcie do 2027-08-15), wymagania pamięci: https://github.com/Cisco-Talos/clamav/releases , https://docs.clamav.net/faq/faq-eol.html , https://docs.clamav.net/manual/Installing/Docker.html ; licencja **GPL-2.0** (zweryfikowane 2026-10-02): https://github.com/Cisco-Talos/clamav/blob/main/COPYING.txt . GPL nie wpływa na licencję systemu, bo ClamAV działa jako osobny proces (`clamd` w osobnym kontenerze, komunikacja przez gniazdo), nie jest linkowany z naszym kodem ani przez nas modyfikowany i dystrybuowany.
- sharp 0.35.5 (Apache-2.0, 2026-09-27): https://www.npmjs.com/package/sharp ; file-type 22.1.1 (MIT): https://www.npmjs.com/package/file-type
- ffmpeg — licencja **LGPL-2.1+**, a przy budowie z `--enable-gpl` (np. libx264) **GPL-2.0+** (zweryfikowane 2026-10-02): https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md . Uruchamiany jako osobny proces w kontenerze `media-processor` (obraz z dystrybucji), bez linkowania z naszym kodem i bez dystrybucji poza naszą infrastrukturą — brak wpływu na licencję systemu.
- rclone 1.75.1 (2026-09-04), `crypt`: https://rclone.org/crypt/ ; licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/rclone/rclone/blob/master/COPYING
- Hetzner Storage Box (BX11 1 TB 3,92 EUR, BX21 5 TB 11,40 EUR; snapshoty): https://www.hetzner.com/storage/storage-box/
- CWE-434, CWE-400: https://cwe.mitre.org/data/definitions/434.html , https://cwe.mitre.org/data/definitions/400.html
