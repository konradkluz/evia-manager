import { expiryDate, inDays, SURVEY_EXTENSIONS_MAX, type Expiry } from './site-survey.ts';

/**
 * Polish texts of the site survey ("Wizja lokalna", EVM-138; docs/ux/flows/17-wizja-lokalna.md → W-06). Kept next to the screens as plain
 * maps and functions (like `media-labels.ts`) because the deadline needs the Polish plural (1 dzień, 5 dni). Never an address, a phone
 * or a name of a customer in a text that is also an accessible name of a list row (flows/17, rule 4).
 */
export const surveyText = {
  mark: 'Wizja lokalna',
  markName: 'Oznaczenie: Wizja lokalna',
  rejected: 'Odrzucona',
  rejectedName: 'Oznaczenie: Odrzucona',
  noCustomer: 'Brak klienta',
  requesterPhone: 'Telefon zamawiającego',
  callRequester: 'Zadzwoń na telefon zamawiającego',
  bannerTitle: 'Wizja lokalna — brak klienta',
  bannerNeedsDecision: 'Wizja lokalna — brak klienta, wymaga decyzji',
  needsDecision: 'Wymaga decyzji.',
  assign: 'Przypisz klienta',
  reject: 'Odrzuć wizję…',
  restore: 'Przywróć wizję…',
  restoreEditorHint: 'Przywrócić wizję może tylko administrator.',
  offlineAssign: 'Przypiszesz po powrocie połączenia.',
  offlineReject: 'Odrzucisz po powrocie połączenia.',
  offlineRestore: 'Przywrócisz po powrocie połączenia.',
  overviewNoProcesses:
    'Wizja lokalna nie ma procesów ani płatności. Dokumentację z oględzin znajdziesz w zakładkach „Dziennik” i „Media i dokumenty”.',
  payments: 'Płatności',
  paymentsHint: 'Płatności dodasz po przypisaniu klienta.',
  addMilestone: 'Dodaj transzę',
  documentsHint: 'Dokumenty dodasz po przypisaniu klienta.',
  exportHint: 'Eksport ZIP będzie dostępny po przypisaniu klienta.',
  customerCardHint: 'Klienta przypiszesz po akceptacji oferty.',
} as const;

const DAYS_TEXT = (days: number): string => inDays(days);

/** The deadline as a line with an icon: "Wygasa za 80 dni", "Wygasa dziś", the passed one, "Usunięcie za 9 dni" of a rejected survey. */
export function expiryLine(expiry: Expiry, rejected: boolean): string {
  if (expiry.kind === 'passed') return 'Termin minął — wizja zostanie wkrótce usunięta.';
  if (rejected) return expiry.kind === 'today' ? 'Usunięcie dziś' : `Usunięcie ${DAYS_TEXT(expiry.days)}`;
  return expiry.kind === 'today' ? 'Wygasa dziś' : `Wygasa ${DAYS_TEXT(expiry.days)}`;
}

/** The accessible name of the deadline: with the full date (`wygasa za 80 dni, dnia 14.02.2027`). */
export function expiryName(expiry: Expiry, expiresAt: string, rejected: boolean): string {
  if (expiry.kind === 'passed') return `termin minął, wizja zostanie wkrótce usunięta, dnia ${expiryDate(expiresAt)}`;
  const verb = rejected ? 'usunięcie' : 'wygasa';
  const when = expiry.kind === 'today' ? 'dziś' : DAYS_TEXT(expiry.days);
  return `${verb} ${when}, dnia ${expiryDate(expiresAt)}${expiry.warning && !rejected ? ' — wymaga decyzji' : ''}`;
}

/** The text of the banner of an open survey: the date of deletion, the days and — from the first extension — the count. */
export function bannerBody(expiry: Expiry, expiresAt: string, extensionCount: number): string {
  const date = expiryDate(expiresAt);
  const lead =
    expiry.kind === 'passed'
      ? 'Termin minął — wizja zostanie wkrótce usunięta razem ze zdjęciami, filmami i wpisami, jeśli nie przypiszesz klienta.'
      : `Wizja zostanie trwale usunięta dnia ${date} (${expiry.kind === 'today' ? 'dziś' : DAYS_TEXT(expiry.days)}) — razem ze zdjęciami, filmami i wpisami — jeśli nie przypiszesz klienta.`;
  return extensionCount > 0 ? `${lead} Przedłużono ${String(extensionCount)} z ${String(SURVEY_EXTENSIONS_MAX)} razy.` : lead;
}

/** The text of the banner of a rejected survey (flows/17 "Wizja odrzucona": without the reason, which the API does not return). */
export function rejectedBannerBody(expiry: Expiry, expiresAt: string): string {
  if (expiry.kind === 'passed') return 'Termin minął — wizja zostanie wkrótce usunięta razem ze zdjęciami, filmami i wpisami.';
  return `Wizja zostanie trwale usunięta dnia ${expiryDate(expiresAt)} (${expiry.kind === 'today' ? 'dziś' : DAYS_TEXT(expiry.days)}) — razem ze zdjęciami, filmami i wpisami.`;
}

/** "Przypisz klienta" — the dialog (flows/17 → "Dialog „Przypisz klienta”") and the dialog of the rule of the acceptance. */
export const assignText = {
  title: 'Przypisz klienta',
  chooseTitle: 'Wybierz klienta',
  close: 'Zamknij okno',
  once: 'Klienta możesz przypisać tylko raz — nie da się go później zmienić.',
  hint: 'Wpisz nazwisko, nazwę firmy albo telefon, aby wyszukać.',
  or: 'albo',
  addNew: 'Dodaj nowego klienta',
  addNewTitle: 'Dodaj nowego klienta',
  backToChoice: 'Wróć do wyboru',
  phoneFilled: 'Telefon podstawiliśmy z wizji — sprawdź go.',
  added: 'Dodano klienta.',
  next: 'Dalej',
  cancel: 'Anuluj',
  back: 'Wróć',
  confirmTitle: (number: string) => `Przypisać klienta do wizji ${number}?`,
  confirmCustomer: (name: string) => `Klient: ${name}`,
  confirmBody:
    'Tego nie da się cofnąć ani zmienić. Wizja przestanie wygasać i stanie się zwykłym zleceniem; telefon zamawiającego zostanie usunięty. Zdjęcia, filmy, wpisy i numer zostają.',
  confirm: 'Przypisz klienta',
  confirmName: (name: string, number: string) => `Przypisz klienta ${name} do wizji ${number} — nieodwracalnie`,
  assigned: 'Przypisano klienta. Wizja jest teraz zwykłym zleceniem.',
  failure: {
    conflict: 'To zlecenie zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.',
    refresh: 'Odśwież zlecenie',
    alreadySet: 'Ta wizja ma już klienta. Odśwież stronę, aby zobaczyć aktualny stan.',
    customerGone: 'Nie znaleziono wybranego klienta. Wybierz innego.',
    forbidden: 'Nie możesz przypisać klienta. Poproś administratora.',
    network: 'Nie udało się przypisać klienta. Spróbuj ponownie — nie przypiszemy go dwa razy.',
    server: (code: string) => `Nie udało się przypisać klienta. Spróbuj ponownie — nie przypiszemy go dwa razy. Kod błędu: ${code}.`,
    rate: (seconds: number) => `Zbyt wiele prób. Spróbuj ponownie za ${String(seconds)} s.`,
  },
} as const;

export const acceptText = {
  title: 'Aby zaakceptować, przypisz klienta',
  body: 'Wizja lokalna nie ma klienta. Przypisz klienta, a potem zaakceptuj zlecenie.',
  close: 'Zamknij okno',
  cancel: 'Anuluj',
  assign: 'Przypisz klienta',
} as const;

/** "Odrzuć wizję" (AC5; flows/17 → "Dialog „Odrzuć wizję”"). */
export const rejectText = {
  title: 'Odrzuć wizję lokalną',
  body: 'Wizja zostanie trwale usunięta po 14 dniach — razem ze zdjęciami, filmami i wpisami. Przywrócić ją w tym czasie może tylko administrator.',
  reasonLegend: 'Powód',
  offerRejected: 'Oferta odrzucona',
  customerWithdrew: 'Rezygnacja klienta',
  reasonRequired: 'Wybierz powód odrzucenia.',
  cancel: 'Anuluj',
  confirm: 'Odrzuć wizję',
  rejected: (date: string) => `Odrzucono wizję. Zostanie usunięta dnia ${date}.`,
  rejectedNoDate: 'Odrzucono wizję.',
  bannerTitle: 'Wizja odrzucona',
  failure: {
    conflict: 'Tę wizję zmieniono w międzyczasie. Sprawdź jej aktualny stan i spróbuj ponownie.',
    refresh: 'Odśwież zlecenie',
    forbidden: 'Nie możesz odrzucić wizji. Poproś administratora.',
    reason: 'Nie przyjęliśmy powodu odrzucenia. Wybierz powód jeszcze raz.',
    network: 'Nie udało się odrzucić wizji. Spróbuj ponownie.',
    server: (code: string) => `Nie udało się odrzucić wizji. Spróbuj ponownie. Kod błędu: ${code}.`,
    rate: (seconds: number) => `Zbyt wiele prób. Spróbuj ponownie za ${String(seconds)} s.`,
  },
} as const;

/** "Przywróć wizję" (AC5). */
export const restoreText = {
  title: 'Przywrócić wizję?',
  body: 'Wizja wróci do statusu „Wstrzymane”, a termin jej usunięcia zostanie ustawiony od nowa (nie krótszy niż 14 dni).',
  cancel: 'Anuluj',
  confirm: 'Przywróć wizję',
  restored: (date: string) => `Przywrócono wizję. Termin usunięcia: ${date}.`,
  restoredNoDate: 'Przywrócono wizję.',
  stepUpTitle: 'Potwierdź tożsamość, aby przywrócić wizję',
  failure: {
    conflict: 'Tę wizję zmieniono w międzyczasie. Sprawdź jej aktualny stan i spróbuj ponownie.',
    refresh: 'Odśwież zlecenie',
    forbidden: 'Nie możesz przywrócić wizji. Poproś administratora.',
    stepUp: 'Przywrócenie wymaga potwierdzenia tożsamości. Spróbuj ponownie i potwierdź tożsamość.',
    network: 'Nie udało się przywrócić wizji. Spróbuj ponownie.',
    server: (code: string) => `Nie udało się przywrócić wizji. Spróbuj ponownie. Kod błędu: ${code}.`,
    rate: (seconds: number) => `Zbyt wiele prób. Spróbuj ponownie za ${String(seconds)} s.`,
  },
} as const;
