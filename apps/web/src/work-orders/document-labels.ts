import type { DocumentConfidentiality } from '@evia/contracts';

// Texts of the documents of an order (W-09 "Dokumenty zlecenia"; EVM-047). Titles, descriptions and file names come from the server and are
// always shown as text (SR-WEB-03); nothing here carries them.

/** The order of the classes (`standard` < `building_security` < `identity_data`); an unknown class counts as the most restricted. */
const ORDER: readonly DocumentConfidentiality[] = ['standard', 'building_security', 'identity_data'];

export const confidentialityLabels: Readonly<Record<DocumentConfidentiality, string>> = {
  standard: 'Standardowy',
  building_security: 'Bezpieczeństwo budynku',
  identity_data: 'Dane identyfikacyjne',
};

export function confidentialityRank(value: string): number {
  const index = ORDER.indexOf(value as DocumentConfidentiality);
  return index === -1 ? ORDER.length - 1 : index;
}

export function confidentialityLabel(value: string): string {
  return confidentialityLabels[ORDER[confidentialityRank(value)] ?? 'identity_data'];
}

/** The classes a document can be raised to: strictly higher than `current` (the server checks it again). */
export function higherClasses(current: string): readonly ('building_security' | 'identity_data')[] {
  const rank = confidentialityRank(current);
  return (['building_security', 'identity_data'] as const).filter((value) => confidentialityRank(value) > rank);
}

/** The class a document gets before it is sent: the class of the kind, or "Dane identyfikacyjne" for "Inny dokument" with a "Tak". */
export function effectiveClass(kindClass: string, containsIdentityData: boolean): string {
  return containsIdentityData ? 'identity_data' : kindClass;
}

/** The code of the kind "Inny dokument" (the question about PESEL is asked for it only). */
export const OTHER_KIND = 'other';

export const documentText = {
  heading: (count: number) => `Dokumenty zlecenia (${String(count)})`,
  tableCaption: 'Dokumenty zlecenia',
  add: 'Dodaj dokument',
  empty: 'Brak dokumentów.',
  emptyHint: 'Dodaj dokumenty formalne do tego zlecenia: warunki przyłączenia, pełnomocnictwo, projekt.',
  emptyReadOnly: 'Do tego zlecenia nie dodano jeszcze dokumentów.',
  raiseHighest: 'Dokument ma już najwyższą klasę.',
  loadFailed: 'Nie wczytano dokumentów',
  loadFailedHint: 'Sprawdź połączenie i spróbuj ponownie.',
  retryLoad: 'Spróbuj ponownie',
  showMore: 'Pokaż więcej',
  columns: { kind: 'Rodzaj', title: 'Tytuł', version: 'Wersja', confidentiality: 'Klasa', state: 'Plik', actions: 'Akcje' },
  actionsLabel: (title: string) => `Akcje dokumentu: ${title}`,
  // dialog "Dodaj dokument"
  dialogTitle: 'Dodaj dokument',
  closeDialog: 'Zamknij okno',
  cancel: 'Anuluj',
  submit: 'Dodaj dokument',
  chooseFile: 'Wybierz plik',
  fileInput: 'Plik dokumentu',
  limits: 'Dokumenty: PDF, DOCX, XLSX, JPG, PNG do 100 MB',
  removeFile: 'Usuń z wyboru',
  fileMissing: 'Wybierz plik dokumentu.',
  unsupported: (name: string) => `Plik „${name}” ma nieobsługiwany format. Dodaj plik PDF, DOCX, XLSX, JPG lub PNG.`,
  tooLarge: (name: string) => `Plik „${name}” jest większy niż 100 MB.`,
  emptyFile: (name: string) => `Plik „${name}” jest pusty.`,
  kind: 'Rodzaj dokumentu',
  kindPlaceholder: 'Wybierz rodzaj',
  kindMissing: 'Wybierz rodzaj dokumentu.',
  kindsFailed: 'Nie wczytano rodzajów dokumentów. Spróbuj ponownie.',
  identityQuestion: 'Czy dokument zawiera PESEL lub numer dokumentu tożsamości?',
  identityNo: 'Nie',
  identityYes: 'Tak — klasa „Dane identyfikacyjne”',
  identityMissing: 'Odpowiedz, czy dokument zawiera PESEL lub numer dokumentu tożsamości.',
  titleField: 'Tytuł',
  titleMissing: 'Wpisz tytuł dokumentu.',
  descriptionField: 'Opis (opcjonalnie)',
  descriptionHint: 'Nie wpisuj PESEL ani numerów dokumentów.',
  classFromKind: (label: string) => `Klasa poufności: z rodzaju — ${label}`,
  raise: 'Podnieś klasę',
  raiseNone: 'Bez podniesienia',
  raiseHint: 'Tylko klasy wyższe niż z rodzaju.',
  // raising from the menu `⋮`
  raiseMenu: 'Podnieś klasę…',
  raiseTitle: 'Podnieś klasę dokumentu',
  raiseBody: 'Klasy nie można później obniżyć. Dokument o wyższej klasie pobierze tylko administrator i edytor.',
  raiseConfirm: 'Podnieś klasę',
  raiseTarget: 'Nowa klasa',
  raiseConflict: 'Dokument zmienił się w międzyczasie. Odśwież listę i spróbuj ponownie.',
  raiseRejected: 'Wybierz klasę wyższą niż obecna.',
  raiseForbidden: 'Nie masz uprawnień do zmiany klasy dokumentu.',
  raiseFailed: 'Nie udało się podnieść klasy. Spróbuj ponownie.',
  // state of the file
  waiting: 'Czeka na plik',
  checking: 'Sprawdzanie pliku',
  checkingDetail: 'Pobranie będzie możliwe po sprawdzeniu.',
  ready: 'Gotowy',
  attention: 'Wymaga uwagi',
  attentionDetail: 'Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.',
  checksumFailed: 'Nie wysłano — plik uszkodzony w czasie wysyłania',
  failedFile: 'Nie przetworzono pliku',
  restricted: 'Plik dostępny dla administratora i edytora',
  restrictedClass: (label: string) => `${label} (klasa ograniczona)`,
  // upload panel
  panelLabel: 'Wysyłanie dokumentu',
  hashing: 'Przygotowanie pliku',
  creating: 'Dodawanie dokumentu',
  sending: (percent: number) => `Wysyłanie ${String(percent)}%`,
  uploadingNote: 'Nie zamykaj karty do końca wysyłania.',
  offlineNote: 'Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.',
  retry: 'Ponów',
  dismiss: 'Ukryj',
  sent: 'Wysłano. Sprawdzamy plik.',
  failures: {
    network: 'Nie wysłano — przerwane połączenie.',
    rate: 'Zbyt wiele zapytań. Spróbuj ponownie za chwilę.',
    validation: 'Nie wysłano — serwer odrzucił dokument. Sprawdź rodzaj, tytuł i plik.',
    forbidden: 'Nie masz uprawnień do dodawania dokumentów.',
    conflict: 'Nie wysłano — dokument o tym identyfikatorze już istnieje. Dodaj go ponownie.',
    server: 'Nie udało się wysłać dokumentu. Spróbuj ponownie.',
  },
  // download
  download: 'Pobierz',
  downloadFile: (title: string) => `Pobierz plik: ${title}`,
  downloadMenu: 'Pobierz plik',
  downloadLimited: 'Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.',
  downloadForbidden: 'Nie masz uprawnień do pobrania tego pliku.',
  downloadGone: 'Nie znaleziono pliku. Mógł zostać usunięty.',
  downloadFailed: 'Nie udało się pobrać pliku. Spróbuj ponownie.',
} as const;
