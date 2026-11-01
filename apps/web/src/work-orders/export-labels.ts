import { formatBytes } from './media-labels.ts';

/** Texts of the ZIP export of the photos of an order (EVM-052; W-09, W-04; mikrocopy of flows/06-galeria-i-upload.md). */
export const exportText = {
  button: 'Eksportuj zdjęcia (ZIP)',
  stepUpTitle: 'Potwierdź tożsamość, aby wyeksportować zdjęcia (ZIP)',
  noPhotosHint: 'Eksport jest możliwy, gdy zlecenie ma zdjęcia gotowe do pobrania.',
  offlineHint: 'Brak połączenia — eksport jest wyłączony do jego powrotu.',
  confirmTitle: 'Wyeksportować zdjęcia?',
  confirmBody:
    'Przygotujemy jeden plik ZIP z oryginałami zdjęć tego zlecenia. Pliki mogą zawierać metadane, np. lokalizację. Plik będzie ważny 24 godziny, a link do niego zadziała raz. Administratorzy dostaną o eksporcie wiadomość e-mail.',
  confirm: 'Eksportuj',
  cancel: 'Anuluj',
  closeDialog: 'Zamknij okno',
  preparing: 'Przygotowujemy plik ZIP. Link pokażemy tutaj, gdy będzie gotowy — będzie ważny 24 godziny i zadziała raz.',
  ready: (count: number | undefined, bytes: number | undefined, until: string) =>
    `Plik ZIP jest gotowy${count === undefined || bytes === undefined ? '' : ` (${String(count)} ${count === 1 ? 'zdjęcie' : 'zdjęć'}, ${formatBytes(bytes)})`}. Link zadziała raz, plik jest ważny do ${until}.`,
  download: 'Pobierz ZIP',
  downloadTitle: 'Pobrać plik ZIP?',
  downloadBody: 'Pliki mogą zawierać metadane, np. lokalizację. Link zadziała raz — po pobraniu trzeba będzie zlecić nowy eksport.',
  downloaded: 'Link do pliku ZIP został już wystawiony i nie zadziała ponownie. Aby pobrać zdjęcia jeszcze raz, zleć nowy eksport.',
  failed: 'Nie udało się przygotować pliku. Spróbuj ponownie.',
  notConfirmed: 'Nie wykonano operacji.',
  network: 'Brak połączenia z serwerem. Nie wykonano operacji.',
  forbidden: 'Nie masz uprawnień do eksportu zdjęć.',
  notFound: 'Nie znaleziono zlecenia. Mogło zostać usunięte.',
  noMedia: 'Zlecenie nie ma zdjęć do eksportu.',
  tooLarge: 'Zdjęcia zlecenia przekraczają limit eksportu (10 GB).',
  limited: 'Kolejny eksport możliwy za 10 min (maks. 5 dziennie).',
  unavailable: 'Eksport jest chwilowo niedostępny. Spróbuj ponownie później.',
  server: 'Nie udało się zlecić eksportu. Spróbuj ponownie.',
  gone: 'Plik ZIP nie jest już dostępny. Zleć nowy eksport.',
  downloadFailed: 'Nie udało się pobrać pliku ZIP. Spróbuj ponownie.',
} as const;
