import type { MediaCategory } from '@evia/contracts';

/**
 * Polish texts of the tab "Media i dokumenty" and of the upload (EVM-044; docs/ux/flows/06-galeria-i-upload.md → W-09, W-09 w
 * przeglądarce telefonu). Kept next to the screens as plain maps and functions (like `payment-labels.ts`) because a count needs the
 * Polish plural (1 zdjęcie, 2 zdjęcia, 5 zdjęć) and the texts are not keys of the catalogue. Names of files are never part of a text
 * here: they are rendered by the screens as React text (SR-WEB-03).
 */
const plural = new Intl.PluralRules('pl-PL');

/** `1 zdjęcie`, `2 zdjęcia`, `5 zdjęć`, `22 zdjęcia`. */
export function photosCount(count: number): string {
  switch (plural.select(count)) {
    case 'one':
      return `${String(count)} zdjęcie`;
    case 'few':
      return `${String(count)} zdjęcia`;
    default:
      return `${String(count)} zdjęć`;
  }
}

/** Genitive after a negation: "Nie wysłano 1 zdjęcia", "Nie wysłano 3 zdjęć". */
export function photosNotSent(count: number): string {
  return count === 1 ? 'Nie wysłano 1 zdjęcia' : `Nie wysłano ${String(count)} zdjęć`;
}

/** `1 plik`, `2 pliki`, `5 plików`. */
export function filesCount(count: number): string {
  switch (plural.select(count)) {
    case 'one':
      return `${String(count)} plik`;
    case 'few':
      return `${String(count)} pliki`;
    default:
      return `${String(count)} plików`;
  }
}

/** The categories of the contract (styleguide: the closed list; an unknown value of a newer server is "Inne"). */
export const mediaCategoryLabels: Readonly<Record<MediaCategory, string>> = {
  site_survey: 'Oględziny',
  before_work: 'Przed pracami',
  in_progress: 'W trakcie prac',
  completed_work: 'Po pracach',
  defect: 'Usterka',
  measurement: 'Pomiary',
  other: 'Inne',
};

export function categoryLabel(category: string): string {
  return (mediaCategoryLabels as Readonly<Record<string, string>>)[category] ?? mediaCategoryLabels.other;
}

/** `720 B`, `4,1 MB` — the size of a chosen file in the decimal units of the mockup. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ${units[unit] ?? 'GB'}`;
}

export const mediaText = {
  tab: 'Media i dokumenty',
  heading: 'Media i dokumenty',
  photosHeading: (count: number, more: boolean) => `Zdjęcia · ${more ? 'co najmniej ' : ''}${photosCount(count)}`,
  addPhotos: 'Dodaj zdjęcia lub filmy',
  dropLabel: 'Upuść zdjęcia tutaj albo',
  chooseFiles: 'Wybierz pliki',
  chooseFromGallery: 'Wybierz z galerii',
  chosenFilesInput: 'Wybrane pliki',
  limits: 'Zdjęcia: JPEG, HEIC, PNG, WebP do 50 MB.',
  dialogTitle: 'Dodaj zdjęcia lub filmy',
  dialogIntro: 'Zdjęcia rób aparatem telefonu, a potem wybierz je tutaj z galerii.',
  dialogPrivacy: 'Przed zdjęciami do pracy: lokalizacja w aparacie wyłączona, automatyczna kopia zdjęć w chmurze wyłączona.',
  closeDialog: 'Zamknij',
  cancel: 'Anuluj',
  chosen: (count: number, totalBytes: number) => `Wybrano ${filesCount(count)} · ${formatBytes(totalBytes)}`,
  removeFromChoice: (name: string) => `Usuń z wyboru: ${name}`,
  removeFromChoiceShort: 'Usuń z wyboru',
  skipped: (count: number) => (count === 1 ? 'Pominięto 1 plik:' : `Pominięto ${filesCount(count)}:`),
  unsupportedFormat: (name: string) => `Plik „${name}” ma nieobsługiwany format. Wybierz zdjęcie JPEG, HEIC, PNG albo WebP.`,
  tooLarge: (name: string) => `Plik „${name}” jest większy niż 50 MB. Zmniejsz go albo wybierz inny.`,
  emptyFile: (name: string) => `Plik „${name}” jest pusty.`,
  tooMany: 'Naraz można wysłać najwyżej 50 plików. Wyślij resztę w kolejnej partii.',
  category: 'Kategoria',
  description: 'Opis (opcjonalnie)',
  descriptionReminder: 'Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.',
  send: (count: number) => `Wyślij ${filesCount(count)}`,
  progressHeading: (done: number, total: number) => `Wysyłanie · ${String(done)} z ${String(total)}`,
  progressHint: 'Nie zamykaj karty do końca wysyłania. Po zablokowaniu ekranu wysyłanie zatrzyma się i wznowi po powrocie.',
  progressRegion: 'Wysyłanie plików',
  sentHeading: 'Wysłane pliki',
  queued: 'W kolejce',
  preparing: 'Przygotowanie pliku',
  uploading: (percent: number) => `Wysyłanie ${String(Math.round(percent))}%`,
  uploadProgress: (name: string) => `Postęp wysyłania pliku ${name}`,
  paused: 'Wstrzymano',
  pausedOffline: 'Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.',
  checking: 'Sprawdzanie pliku',
  checkingDetail: 'Nie usuwaj go jeszcze z telefonu.',
  done: 'Wysłano',
  attention: 'Wymaga uwagi',
  attentionDetail: 'Nie usuwaj tego pliku z telefonu. Administrator został powiadomiony.',
  attentionPlain: 'Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.',
  failedChecksum: 'Nie wysłano — plik uszkodzony w transmisji',
  failedDifferent: 'Nie wysłano — plik różni się od wysłanego wcześniej',
  failedAnnounce: (count: number) =>
    `${count === 1 ? 'Nie wysłano 1 pliku' : `Nie wysłano ${String(count)} plików`}. Użyj przycisku „Ponów”.`,
  failedNetwork: 'Nie wysłano — przerwane połączenie',
  failedServer: 'Nie wysłano — spróbuj ponownie',
  failedStorage: 'Nie wysłano — magazyn plików jest chwilowo niedostępny',
  failedIncomplete: 'Nie wysłano — brakuje części pliku',
  rateLimited: (seconds: number | null) =>
    seconds === null
      ? 'Zbyt wiele zapytań. Spróbuj ponownie za chwilę.'
      : `Zbyt wiele zapytań. Spróbuj ponownie za ${seconds >= 60 ? `${String(Math.ceil(seconds / 60))} min` : `${String(seconds)} s`}.`,
  pause: 'Wstrzymaj',
  pauseFile: (name: string) => `Wstrzymaj wysyłanie: ${name}`,
  resume: 'Wznów',
  resumeFile: (name: string) => `Wznów wysyłanie: ${name}`,
  retry: 'Ponów',
  retryFile: (name: string) => `Ponów wysyłanie: ${name}`,
  sentAll: (count: number) => `Wysłano ${photosCount(count)} — możesz je usunąć z telefonu. Potem opróżnij kosz galerii.`,
  sentSome: (done: number, total: number) => `Wysłano ${String(done)} z ${String(total)} plików.`,
  startFailed: 'Nie udało się rozpocząć wysyłania. Spróbuj ponownie — nie dodamy plików dwa razy.',
  unfinishedBanner: 'Niedokończone wysyłanie zdjęć',
  unfinished: (count: number) => `${photosNotSent(count)} — wybierz je ponownie z galerii.`,
  unfinishedHelp: 'Wybierz te same pliki — dopasujemy je po nazwie i rozmiarze.',
  chooseAgain: 'Wybierz ponownie z galerii',
  empty: 'To zlecenie nie ma jeszcze zdjęć.',
  emptyHint: 'Dodaj pierwsze zdjęcia przyciskiem powyżej.',
  loading: 'Wczytywanie mediów…',
  loadFailed: 'Nie udało się wczytać mediów.',
  loadFailedHint: 'Sprawdź połączenie i spróbuj jeszcze raz.',
  retryLoad: 'Spróbuj ponownie',
  showMore: 'Pokaż starsze',
  offline: 'Brak połączenia — wysyłanie wstrzymane.',
  emptyReadOnly: 'Zdjęcia dodaje Administrator albo Edytor.',
  photo: 'Zdjęcie',
  video: 'Film',
  waitingForFile: 'Czeka na plik',
  waitingSince: (time: string) => `od ${time}`,
  storageUnavailable: 'Wysyłanie zdjęć jest chwilowo niedostępne. Spróbuj ponownie później.',
} as const;
