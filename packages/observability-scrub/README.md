# `@evia/observability-scrub` — czyszczenie zdarzeń i okruszków śledzenia błędów

Pakiet z EVM-085 (AC6, AC7; ADR-0013, ADR-0018, RR-24). Czysty TypeScript bez zależności uruchomieniowych i bez typów `@sentry/*` (typy strukturalne), więc nadaje się też dla aplikacji mobilnej.

## Zasada
Lista dozwolonych zamiast listy zabronionych: ze zdarzenia zostają typ wyjątku i stacktrace (bez zmiennych lokalnych), `request.method`, `request.url` bez query i fragmentu, tagi z listy, `user.id` (UUID) i okruszki. Wszystko inne (treść żądania, ciasteczka, nagłówki, `extra`, `contexts`, nazwa serwera) jest usuwane. Komunikaty i adresy przechodzą przez redakcję: ścieżka `/api/v1/auth/activation/*`, token 43 znaki, JWT, `Bearer`, tokeny GitHub, parametry podpisanych adresów S3, e-mail, query i fragment.

## Użycie (po stronie SDK)
`beforeSend: (event) => scrubEvent(event)` i `beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb)`. Śledzenie (transakcje, spany) pozostaje wyłączone; po jego włączeniu trzeba oczyścić także `beforeSendTransaction` i `beforeSendSpan`.

## Polecenia
`pnpm --filter @evia/observability-scrub run test:coverage`
