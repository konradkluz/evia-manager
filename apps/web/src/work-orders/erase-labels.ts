import { formatDate } from './format.ts';

/**
 * Polish texts of "Usuń" and "Usuń plik trwale…" of a medium and of a document (EVM-051; W-09). Kept next to the screens as plain
 * maps and functions (like `media-labels.ts`). No text repeats a name of a file, a title or a description (SR-DATA-08, SR-LOG-03).
 * Nothing promises that the file leaves the backups at once: the old versions of the objects expire after 30 days (ADR-0009, RR-14).
 */
export const eraseText = {
  remove: 'Usuń',
  purge: 'Usuń plik trwale…',
  administratorOnly: 'Usunąć plik może tylko administrator.',
  removed: 'Usunięto.',
  undo: 'Cofnij',
  restored: 'Przywrócono.',
  purged: 'Plik usunięty trwale.',
  offline: 'Brak połączenia. Usuwanie jest niedostępne offline.',
  removeLabel: (what: string) => `Usuń: ${what}`,
  purgeLabel: (what: string) => `Usuń plik trwale: ${what}`,
  purgeTitle: 'Usunąć plik trwale?',
  purgeBodyMedia:
    'Plik zdjęcia lub filmu (oryginał, miniatura i podgląd) zostanie usunięty z magazynu, a opis zostanie skasowany. Tej operacji nie można cofnąć. Rekord zostanie z oznaczeniem, że plik usunął administrator.',
  purgeBodyDocument:
    'Wszystkie wersje pliku dokumentu zostaną usunięte z magazynu, a tytuł i opis zostaną zastąpione oznaczeniem. Tej operacji nie można cofnąć. Rekord zostanie z oznaczeniem, że plik usunął administrator.',
  purgeBackups: 'Poprzednie wersje obiektów w kopiach zapasowych wygasają w ciągu 30 dni; kopie bazy – według polityki retencji.',
  purgeConfirm: 'Usuń plik trwale',
  cancel: 'Anuluj',
  stepUpTitle: 'Potwierdź tożsamość, aby usunąć plik trwale',
  erasedBy: (iso: string) => `Plik usunięty przez administratora ${formatDate(iso)}.`,
  failure: {
    forbidden: 'Nie masz uprawnień do tej operacji.',
    gone: 'Element został już usunięty albo nie istnieje. Lista została odświeżona.',
    erased: 'Plik tego elementu został już usunięty trwale.',
    processing: 'Plik jest jeszcze przetwarzany. Spróbuj ponownie za chwilę.',
    conflict: 'Dane zmieniły się w międzyczasie. Lista została odświeżona, spróbuj ponownie.',
    registerDown: 'Nie udało się usunąć pliku. Plik pozostał bez zmian. Spróbuj ponownie później.',
    notConfirmed: 'Nie wykonano operacji.',
    network: 'Brak połączenia z serwerem. Nie wykonano operacji.',
    server: (code: string) => `Nie udało się wykonać operacji. Spróbuj ponownie. Kod: ${code}`,
  },
} as const;
