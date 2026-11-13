# EVM-084 — weryfikacja polityk bucketów i kluczy (krok A6)

Data: 2026-11-13. Środowisko: staging (Scaleway Object Storage `pl-waw`, projekt `evia-staging`). Historyjka: [EVM-084](../../backlog/M0/EVM-084-backupy-i-test-odtworzenia-staging.md). Skrypt: `infra/deploy-agent/restore/bucket-verify.sh` (macierz `bucket-matrix.tsv`), uruchomiony na VM przez `sudo` z prawdziwymi kluczami 7 aplikacji (`/etc/evia/secrets`, `0600 root`) w 4 bucketach. Polityki bucketów w modelu tylko-Allow (commit `f22d24c5`, RR-90). Wyniki bez sekretów i identyfikatorów kluczy.

**Wynik: PASS** — `security-engineer`: GO dla kluczy w konfiguracji aplikacji (K2); RR-90 zamknięte bez planu B.

## 1. Pełny przebieg (sondy z `f4bef3e5`)
438 × `ok`, 84 × `FAIL`. Wszystkie `FAIL` to trzy wadliwie zbudowane sondy, na które Scaleway odpowiada `400` (walidacja żądania przed autoryzacją), więc nie dowodziły niczego: `PutObjectLockConfiguration` z pustym XML i `DeleteObjectVersion` (z nagłówkiem bypass-governance i bez) z nieprawdziwym `versionId`. Poprawione w `d822469a` i sprawdzone w przebiegu 2.

| Obszar | Wynik |
|---|---|
| Macierz klucz × bucket × obszar × {list, GET, PUT, DELETE} (133 komórki) | wszystkie zgodne |
| Dostęp anonimowy (lista, GET) do 4 bucketów | `403` |
| Szyfrowanie obiektu mediów | SSE obecne |
| Rejestr usunięć | nowy wpis z `If-None-Match: *` → `200`, drugi → `412`, bez nagłówka → `403`, `If-None-Match` z ETagiem → odrzucony (`405`); GET, lista, DELETE → `403` |
| Pochodne workera w media | `thumbnail.webp` z `If-None-Match` → `200`, drugi → `412`, bez nagłówka → `403`; `original` → `403` |
| `x-amz-acl: public-read` (media_app, media_worker, backup_writer) | zapis przyjęty, anonimowy GET obiektu → `403` (obiekt nie jest publiczny) |
| Operacje administracyjne każdym kluczem w każdym buckecie: `PutBucketPolicy`, `DeleteBucketPolicy`, `PutBucketAcl`, `PutBucketCors`, `PutBucketVersioning`, `PutLifecycleConfiguration`, `PutObjectRetention`, `PutObjectLegalHold`, `PutObjectAcl`, `DeleteBucket` | `403` |

## 2. Przebieg sond administracyjnych (`BUCKET_VERIFY_ONLY=admin`, sondy z `d822469a`)
330 × `ok`, 6 × `FAIL`, 0 × `inconclusive`.

- `PutObjectLockConfiguration` z poprawnym XML (identycznym z bieżącą konfiguracją) i `DeleteObjectVersion` z prawdziwym `versionId` (z nagłówkiem bypass-governance i bez) → `403` wszędzie, poza przypadkiem niżej.
- **6 × `FAIL` — nieistotne (`security-engineer`, 2026-11-13):** `DeleteObjectVersion` z nagłówkiem `x-amz-bypass-governance-retention` w bucketach **bez** object lock (rejestr, eksporty) kluczami `media_app`, `media_worker`, `backup_writer` (jedyne z uprawnieniem IAM `ObjectStorageObjectsDelete`) → `400`. To samo żądanie bez nagłówka → `403`; z nagłówkiem w bucketach z lockiem (media, db_backup) → `403` dla wszystkich 7 kluczy. Scaleway odrzuca sam nagłówek jako niepoprawny w buckecie bez locka — nic nie zostaje usunięte.
- Follow-up (minor): w skrypcie bypass w buckecie bez locka przy `400` raportować jako `inconclusive`, gdy ten sam DELETE bez nagłówka daje `403`.

## 3. Obiekty sond pod blokadą
Po obu przebiegach zostają małe (6 B) obiekty sond: db_backup ok. 4–5 (COMPLIANCE 37 dni), media ok. 4–5 (GOVERNANCE 30 dni); bez locka: eksporty (wygasają po 1 dniu), rejestr (40 dni). Po każdej zmianie polityk bucketów lub IAM — ponowić A6.
