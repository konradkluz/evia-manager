import type { MediaAsset, MediaCategory } from '@evia/contracts';
import { formatDate } from './format.ts';

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

/** `1 film`, `2 filmy`, `5 filmów`. */
export function videosCount(count: number): string {
  switch (plural.select(count)) {
    case 'one':
      return `${String(count)} film`;
    case 'few':
      return `${String(count)} filmy`;
    default:
      return `${String(count)} filmów`;
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

/** The heading of a group of the gallery (W-09): the categories of the dialog, except that "Przed pracami" is told "Stan przed pracami" over the tiles (EVM-068 AC1). */
export function groupLabel(category: string): string {
  return category === 'before_work' ? 'Stan przed pracami' : categoryLabel(category);
}

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
  photosHeading: (photos: number, videos: number, more: boolean) =>
    `Zdjęcia i filmy · ${more ? 'co najmniej ' : ''}${[...(photos > 0 || videos === 0 ? [photosCount(photos)] : []), ...(videos > 0 ? [videosCount(videos)] : [])].join(', ')}`,
  groupHeading: (category: string, count: number) => `${category} (${String(count)})`,
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
  // EVM-068: after the scan the server makes the thumbnail and the preview; the file is safe and sent, only the picture is not ready yet
  previewPreparing: 'Przygotowujemy podgląd.',
  processingFailed: 'Nie udało się przygotować podglądu. Spróbujemy ponownie.',
  // EVM-045: the lightbox (W-09, § 3.11) and the download of the original
  openPhoto: (alt: string) => `Powiększ: ${alt}`,
  lightboxTitle: (position: number, total: number, alt: string) => `${alt} (${String(position)} z ${String(total)})`,
  previous: 'Poprzednie',
  next: 'Następne',
  zoomIn: 'Powiększ',
  zoomOut: 'Pomniejsz',
  zoomStatus: (percent: number) => `Powiększenie ${String(percent)}%`,
  previewLoading: 'Wczytywanie podglądu',
  previewOffline: 'Brak połączenia — podgląd wczyta się po jego powrocie.',
  fileGone: 'Nie znaleziono pliku. Mógł zostać usunięty.',
  downloadLimited: 'Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.',
  downloadForbidden: 'Nie masz uprawnień do pobrania tego pliku.',
  downloadFailed: 'Nie udało się pobrać pliku. Spróbuj ponownie.',
  takenAt: (date: string, time: string) => `zrobione ${date}, ${time}`,
  fromPhone: 'z telefonu',
  descriptionLine: (text: string) => `Opis: ${text}`,
  downloadOriginal: 'Pobierz oryginał',
  downloadOffline: 'Brak połączenia — pobieranie jest wyłączone do jego powrotu.',
  originalTitle: 'Pobrać oryginał?',
  originalBody: 'Plik może zawierać metadane, np. lokalizację. Do udostępnienia poza firmą użyj podglądu.',
  downloadPreview: 'Pobierz podgląd',
  thumbnailUnavailable: 'Nie można wyświetlić',
  thumbnailLoading: 'Wczytywanie miniatury',
  thumbnailOffline: 'Brak połączenia — miniatura wczyta się po jego powrocie.',
  galleryOffline: 'Brak połączenia. Pokazujemy zdjęcia zapamiętane w tej karcie; pozostałe wczytają się po powrocie połączenia.',
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
  reasonMalware: 'Skan wykrył zagrożenie',
  reasonTypeMismatch: 'Typ pliku niezgodny z rozszerzeniem',
  reasonGeneral: 'Plik zatrzymany przez skan bezpieczeństwa',
  removalDay: (date: string) => `Plik zostanie usunięty ${date}, jeśli do tego czasu nie przejdzie ponownego skanu.`,
  purged: 'Plik usunięty po 30 dniach kwarantanny',
  purgedDetail: 'Plik został usunięty z magazynu. Nie można go odzyskać.',
  rescan: 'Skanuj ponownie',
  rescanStarted: 'Plik jest skanowany ponownie',
  rescanning: 'Trwa ponowne skanowanie',
  rescanFile: (label: string) => `Skanuj ponownie: ${label}`,
  rescanStepUp: 'Potwierdź tożsamość, aby ponownie przeskanować plik',
  rescanStateChanged: 'Stan pliku się zmienił — odświeżyliśmy listę. Ponowny skan nie jest teraz możliwy.',
  rescanNotFound: 'Nie znaleziono pliku. Mógł zostać usunięty.',
  rescanForbidden: 'Ponowny skan może zlecić tylko administrator.',
  rescanNetwork: 'Nie zlecono ponownego skanu. Sprawdź połączenie i spróbuj ponownie.',
  rescanServer: 'Nie zlecono ponownego skanu. Spróbuj ponownie za chwilę.',
  filterLabel: 'Pokaż',
  filterPrefix: 'Pokaż:',
  attentionEmptyHint: 'Pliki zatrzymane przez skan bezpieczeństwa pojawią się tutaj.',
  filterAll: 'Wszystkie',
  filterAttention: (count: number) => `Wymaga uwagi (${String(count)})`,
  attentionEmpty: 'Brak plików wymagających uwagi.',
  showAll: 'Pokaż wszystkie',
  attentionHeading: (count: number, more: boolean) => `Wymaga uwagi · ${more ? 'co najmniej ' : ''}${filesCount(count)}`,
  storageUnavailable: 'Wysyłanie zdjęć jest chwilowo niedostępne. Spróbuj ponownie później.',
} as const;

/** The reason of a quarantine told in words; a code this panel does not know gets the general label, never the raw code (SR-AUTHZ-04). */
export function quarantineReasonLabel(code: string | undefined): string {
  switch (code) {
    case 'malware_detected':
      return mediaText.reasonMalware;
    case 'type_mismatch':
      return mediaText.reasonTypeMismatch;
    default:
      return mediaText.reasonGeneral;
  }
}

/** The alternative text of a photo from its metadata (§ 3.11): the category and the date. */
export const mediaAlt = (asset: MediaAsset): string =>
  `${mediaText.photo} · ${categoryLabel(asset.category)} · ${formatDate(asset.capturedAt ?? asset.createdAt)}`;
