import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, StyleSheet } from 'react-native';
import { App } from '../src/App';
import { NO_CONTACT, parseContactEmail, parseContactPhone, readContactConfig } from '../src/config/contact-values';
import { pl } from '../src/i18n/pl';
import { ADMINISTRATOR, CLAUSES } from '../src/privacy/content';
import { LICENSES } from '../src/privacy/licenses';
import { PrivacyHelpScreen, type PrivacyHelpScreenProps } from '../src/screens/PrivacyHelpScreen';
import type { StartupChecker } from '../src/startup';
import { size } from '../src/ui/theme';
import { okSignIn, stubOwner, stubPorts, type PortsRig } from './session-helpers';

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  const insets = { top: 24, left: 0, right: 0, bottom: 16 };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.SafeAreaInsetsContext.Provider value={insets}>{children}</actual.SafeAreaInsetsContext.Provider>
    ),
    useSafeAreaInsets: () => insets,
  };
});

const settle = () =>
  act(async () => {
    for (let n = 0; n < 6; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });
const OFFICE = { email: 'office@example.com', phone: '+48 123 456 789' };

function props(over: Partial<PrivacyHelpScreenProps> = {}): PrivacyHelpScreenProps {
  return {
    section: 'help',
    contact: OFFICE,
    version: '0.4.0',
    build: '42',
    lastSyncAt: undefined,
    onBack: jest.fn(),
    openUrl: () => Promise.resolve(),
    copy: () => true,
    ...over,
  };
}

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}

function withOffice(rig: PortsRig, over: { build?: string | null } = {}): PortsRig {
  Object.assign(rig.ports, { privacyHelp: { build: '7', contact: OFFICE, openUrl: () => Promise.resolve(), ...over } });
  return rig;
}

describe('the content of M-11 (EVM-102 AC1)', () => {
  it('EVM-102 AC1: the clauses are the very file of the panel W-19 (a verbatim copy: version and text cannot drift)', () => {
    const web = readFileSync(join(__dirname, '..', '..', 'web', 'src', 'privacy', 'content.ts'), 'utf8').replace(/\r\n/g, '\n');
    const mobile = readFileSync(join(__dirname, '..', 'src', 'privacy', 'content.ts'), 'utf8').replace(/\r\n/g, '\n');
    // after a change in the panel: copy apps/web/src/privacy/content.ts to apps/mobile/src/privacy/content.ts unchanged
    expect(mobile).toBe(web);
  });

  it('EVM-102 AC1: three clauses with their version and date as disclosures; the text opens and closes, nothing is expanded at the start', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    expect(CLAUSES).toHaveLength(3);
    for (const clause of CLAUSES) {
      const header = screen.getByRole('button', {
        name: pl.privacy.privacySection.clauseA11y.replace('{{title}}', clause.title).replace('{{version}}', clause.version),
      });
      expect(header).toBeCollapsed();
      expect(screen.getAllByText(`Wersja ${clause.version} · od ${clause.validFrom}`).length).toBeGreaterThan(0);
    }
    const firstParagraph = CLAUSES[0]?.blocks.find((block) => block.kind === 'paragraph');
    const text = firstParagraph?.kind === 'paragraph' ? firstParagraph.text : '';
    expect(text).not.toBe('');
    expect(screen.queryByText(text)).toBeNull();
    await fireEvent.press(screen.getByTestId('privacy-clause-clients'));
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-clause-clients')).toBeExpanded();
    await fireEvent.press(screen.getByTestId('privacy-clause-clients'));
    expect(screen.queryByText(text)).toBeNull();
  });

  it('EVM-102 AC1: the header of a disclosure is at least 48 dp high and shows the focus ring while it has the focus', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    const header = screen.getByTestId('privacy-clause-clients');
    const style = () => StyleSheet.flatten(header.props.style as never) as Record<string, number | string>;
    expect(style().minHeight).toBe(size.touchTarget.min);
    expect(style().borderWidth).toBe(0);
    await fireEvent(header, 'focus');
    expect(style().borderWidth).toBe(size.focusRing.width);
    await fireEvent(header, 'blur');
    expect(style().borderWidth).toBe(0);
  });

  it('EVM-102 AC1: the whole text of every clause is rendered when it is expanded (headings, paragraphs and lists)', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    for (const clause of CLAUSES) {
      await fireEvent.press(screen.getByTestId(`privacy-clause-${clause.id}`));
      for (const block of clause.blocks) {
        if (block.kind === 'list') {
          for (const item of block.items) expect(screen.getAllByText(`•  ${item}`).length).toBeGreaterThan(0);
        } else {
          expect(screen.getAllByText(block.text).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('EVM-133 AC1, EVM-149 AC1: the data of the controller are shown as the panel has them (the data of the register, one version 1.1 and one date)', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    expect(ADMINISTRATOR.name).toBe('Electroplus Realty');
    expect(ADMINISTRATOR.registry).toContain('KRS 0001109597');
    expect(ADMINISTRATOR.dataContact).toContain('kontakt@electroplus.io');
    // one version and one date for the three clauses; the date of 1.1 is the day of the merge of EVM-149 (never the date of 1.0)
    const stamps = new Set(CLAUSES.map((clause) => `${clause.version} ${clause.validFrom}`));
    expect(stamps.size).toBe(1);
    const date = CLAUSES[0]?.validFrom ?? '';
    expect(date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(date).not.toBe('19.11.2026');
    expect(stamps).toEqual(new Set([`1.1 ${date}`]));
    expect(screen.getAllByText(`Wersja 1.1 · od ${date}`)).toHaveLength(3);
    // the sentence of the clause 1.1 about the offer at the site visit reaches the application (EVM-149 AC1)
    const clients = CLAUSES.find((clause) => clause.id === 'clients')?.blocks ?? [];
    const texts = clients.flatMap((block) => (block.kind === 'list' ? block.items : [block.text])).join('\n');
    expect(texts).toContain('Na etapie wizji możemy zapisać ofertę z Twoim imieniem i nazwiskiem');
    expect(texts).not.toMatch(/imienia i nazwiska na tym etapie nie zapisujemy/i);
    expect(screen.getByText(`Nazwa: ${ADMINISTRATOR.name}`)).toBeOnTheScreen();
    expect(screen.getByText(`Kontakt w sprawach danych: ${ADMINISTRATOR.dataContact}`)).toBeOnTheScreen();
  });

  it('EVM-102 AC1: the version of the app with the build, or without it when the platform gives none; the last synchronization only after the sign-in', async () => {
    const view = await render(<PrivacyHelpScreen {...props()} />);
    expect(screen.getByTestId('privacy-version')).toHaveTextContent('Wersja 0.4.0 (kompilacja 42)');
    expect(screen.queryByTestId('privacy-last-sync')).toBeNull();
    await view.rerender(<PrivacyHelpScreen {...props({ build: null, lastSyncAt: null })} />);
    expect(screen.getByTestId('privacy-version')).toHaveTextContent('Wersja 0.4.0');
    expect(screen.getByTestId('privacy-last-sync')).toHaveTextContent(pl.privacy.about.lastSyncNone);
    await view.rerender(<PrivacyHelpScreen {...props({ lastSyncAt: Date.UTC(2026, 10, 2, 8, 12) })} />);
    expect(screen.getByTestId('privacy-last-sync')).toHaveTextContent('Ostatnia synchronizacja: 02.11.2026, 9:12');
  });

  it('EVM-102 AC1: "Licencje open source" is a disclosure of the same screen (no second level) and names SQLCipher', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    expect(screen.queryByText(/SQLCipher/)).toBeNull();
    await fireEvent.press(screen.getByTestId('privacy-licenses'));
    expect(screen.getByText(/SQLCipher Community Edition/)).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
  });

  it('EVM-102 AC1: the licence list keeps in step with the dependencies of the app', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const entry of LICENSES) {
      if (entry.dependency !== null) expect(Object.keys(manifest.dependencies)).toContain(entry.dependency);
    }
    expect(LICENSES.some((entry) => entry.name.includes('SQLCipher'))).toBe(true);
  });
});

describe('the contact (EVM-102 AC3)', () => {
  it('EVM-102 AC3: without an address in the build: "zapytaj przełożonego", no address, no link and no number', async () => {
    await render(<PrivacyHelpScreen {...props({ contact: NO_CONTACT })} />);
    expect(screen.getByTestId('privacy-no-contact')).toHaveTextContent('Kontakt z administratorem: zapytaj przełożonego.');
    expect(screen.queryByTestId('privacy-email')).toBeNull();
    expect(screen.queryByTestId('privacy-call')).toBeNull();
    expect(screen.getByTestId('privacy-lost')).toHaveTextContent(pl.privacy.help.lostWithoutAddress, { exact: false });
  });

  it('EVM-102 AC3: the number of the office appears only when the build has it; it opens tel: without spaces', async () => {
    const opened: string[] = [];
    await render(
      <PrivacyHelpScreen
        {...props({
          openUrl: (url) => {
            opened.push(url);
            return Promise.resolve();
          },
        })}
      />,
    );
    await fireEvent.press(screen.getByTestId('privacy-call'));
    await settle();
    expect(opened).toEqual(['tel:+48123456789']);
    expect(screen.getByRole('button', { name: 'Zadzwoń do biura: +48 123 456 789' })).toBeOnTheScreen();
  });

  it('EVM-102 AC3: only a number without an address: the supervisor line and the call action', async () => {
    await render(<PrivacyHelpScreen {...props({ contact: { email: null, phone: OFFICE.phone } })} />);
    expect(screen.getByTestId('privacy-no-contact')).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-call')).toBeOnTheScreen();
  });

  it('EVM-102 AC3: a phone that cannot call shows the number in a message and reports nothing', async () => {
    await render(<PrivacyHelpScreen {...props({ openUrl: () => Promise.reject(new Error('no handler')) })} />);
    await fireEvent.press(screen.getByTestId('privacy-call'));
    await settle();
    expect(screen.getByTestId('privacy-call-failed')).toHaveTextContent('Numer: +48 123 456 789', { exact: false });
  });

  it('EVM-102 AC3: a phone without a mail program: the message, the address and "Kopiuj adres"; copying says so, a failed copy says that too', async () => {
    const opened: string[] = [];
    const copied: string[] = [];
    let copyWorks = true;
    await render(
      <PrivacyHelpScreen
        {...props({
          openUrl: (url) => {
            opened.push(url);
            return Promise.reject(new Error('no mail client'));
          },
          copy: (value) => {
            copied.push(value);
            return copyWorks;
          },
        })}
      />,
    );
    expect(screen.queryByTestId('privacy-mail-failed')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'office@example.com — napisz do administratora' }));
    await settle();
    expect(opened).toEqual(['mailto:office@example.com']);
    expect(screen.getByText('Nie udało się otworzyć poczty.')).toBeOnTheScreen();
    expect(screen.getByText('Adres: office@example.com')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Kopiuj adres' }));
    expect(copied).toEqual(['office@example.com']);
    expect(screen.getByTestId('privacy-copied')).toHaveTextContent('Adres skopiowany.');
    expect(screen.queryByTestId('privacy-mail-failed')).toBeNull();
    // the same with a clipboard that refuses
    copyWorks = false;
    await fireEvent.press(screen.getByRole('button', { name: 'office@example.com — napisz do administratora' }));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Kopiuj adres' }));
    expect(screen.getByTestId('privacy-copy-failed')).toHaveTextContent('Nie udało się skopiować adresu.');
  });

  it('EVM-102 AC3: a mail program that opens leaves no message', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    await fireEvent.press(screen.getByTestId('privacy-email'));
    await settle();
    expect(screen.queryByTestId('privacy-mail-failed')).toBeNull();
    expect(screen.getByTestId('privacy-lost')).toHaveTextContent('zgłoś to od razu: office@example.com', { exact: false });
  });

  it('EVM-102 AC3: the values of the build are validated (a malformed address or number never reaches the screen)', () => {
    expect(parseContactEmail(undefined)).toBeNull();
    expect(parseContactEmail('  ')).toBeNull();
    expect(parseContactEmail(' office@example.com ')).toBe('office@example.com');
    for (const bad of ['office', 'a@b', 'office@example.com?subject=x', 'a b@example.com', 5])
      expect(parseContactEmail(bad)).toBeUndefined();
    expect(parseContactPhone(null)).toBeNull();
    expect(parseContactPhone('')).toBeNull();
    expect(parseContactPhone('+48 123 456 789')).toBe('+48 123 456 789');
    expect(parseContactPhone('123-456-789')).toBe('123-456-789');
    for (const bad of ['12', 'call me', '+48 (22) 123', '123456789012345678', 5]) expect(parseContactPhone(bad)).toBeUndefined();
    expect(readContactConfig(undefined)).toEqual(NO_CONTACT);
    expect(readContactConfig('x')).toEqual(NO_CONTACT);
    expect(readContactConfig({ contactEmail: 'office@example.com', contactPhone: 'nope' })).toEqual({
      email: 'office@example.com',
      phone: null,
    });
  });
});

describe('the information about the telemetry (EVM-102 AC4)', () => {
  it('EVM-102 AC4: "O aplikacji" says that the app sends no crash reports or analytics, and tells to describe the symptoms in the office', async () => {
    await render(<PrivacyHelpScreen {...props()} />);
    expect(screen.getByTestId('privacy-technical')).toHaveTextContent(
      'Aplikacja nie wysyła raportów awarii ani danych analitycznych — tylko synchronizuje się z serwerem EVia. Gdy coś nie działa, opisz objawy w biurze.',
    );
    expect(screen.queryByText(/Raporty awarii: włączone/)).toBeNull();
  });
});

describe('entries and the overlay (EVM-102 AC2)', () => {
  it('EVM-102 AC2: the entry sets the starting section and moves the reader focus to its heading — once', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await render(<PrivacyHelpScreen {...props({ section: 'privacy' })} />);
    expect(focus).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('privacy-help-section-help'), 'layout', { nativeEvent: { layout: { y: 0 } } });
    expect(focus).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('privacy-help-section-privacy'), 'layout', { nativeEvent: { layout: { y: 480 } } });
    expect(focus).toHaveBeenCalledTimes(1);
    const [node, kind] = focus.mock.calls[0] ?? [];
    expect(kind).toBe('focus');
    expect(node).toBeTruthy();
    await fireEvent(screen.getByTestId('privacy-help-section-privacy'), 'layout', { nativeEvent: { layout: { y: 500 } } });
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('EVM-102 AC2: "Pomoc" starts at its own heading and "wstecz" of the bar leaves', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    const onBack = jest.fn();
    await render(<PrivacyHelpScreen {...props({ onBack })} />);
    await fireEvent(screen.getByTestId('privacy-help-section-help'), 'layout', { nativeEvent: { layout: { y: 0 } } });
    expect(focus).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('privacy-help-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('EVM-102 AC2: M-01 offers "Prywatność" before the sign-in: the same screen, no last synchronization, the typed e-mail survives, hardware back closes it', async () => {
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => undefined };
    });
    const owner = stubOwner(okSignIn());
    owner.restoreResult = { kind: 'signed_out' };
    const rig = withOffice(stubPorts(owner), { build: null });
    await open(rig, offline);
    await fireEvent.changeText(screen.getByLabelText(pl.login.email), 'jan@example.test');
    await fireEvent.press(screen.getByTestId('login-privacy'));
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-version')).toHaveTextContent('Wersja 0.4.0');
    expect(screen.queryByTestId('privacy-last-sync')).toBeNull();
    expect(screen.getByRole('button', { name: pl.privacy.help.callA11y.replace('{{phone}}', OFFICE.phone) })).toBeOnTheScreen();
    const handler = handlers.at(-1);
    await act(async () => {
      expect(handler?.({} as never)).toBe(true);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('privacy-help')).toBeNull();
    expect(screen.getByLabelText(pl.login.email)).toHaveDisplayValue('jan@example.test');
    spy.mockRestore();
  });

  it('EVM-102 AC2: while the app is locked hardware back does not close the overlay under the cover; after the unlock it does', async () => {
    const subscriptions: { handler: Parameters<typeof BackHandler.addEventListener>[1]; remove: jest.Mock }[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      const subscription = { handler, remove: jest.fn() };
      subscriptions.push(subscription);
      return subscription;
    });
    const rig = withOffice(stubPorts());
    await open(rig, offline);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    await fireEvent.press(screen.getByTestId('more-privacy'));
    const open1 = subscriptions.at(-1);
    expect(open1?.remove).not.toHaveBeenCalled();
    rig.device.facts.auth = 'cancelled';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot += 6 * 60_000;
      rig.device.time.wall += 6 * 60_000;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(open1?.remove).toHaveBeenCalled();
    const registered = subscriptions.length;
    expect(subscriptions.slice(registered - 1).every((subscription) => subscription.remove.mock.calls.length > 0)).toBe(true);
    rig.device.facts.auth = 'success';
    await act(async () => {
      await rig.ports.guard.unlock();
    });
    await settle();
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
    const again = subscriptions.at(-1);
    expect(again?.remove).not.toHaveBeenCalled();
    await act(async () => {
      expect(again?.handler({} as never)).toBe(true);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('privacy-help')).toBeNull();
    spy.mockRestore();
  });

  it('EVM-102 AC2: "Więcej" has "Pomoc" and "Prywatność": the same content offline, with the last synchronization of the session', async () => {
    const rig = withOffice(stubPorts());
    await open(rig, offline);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    await fireEvent.press(screen.getByTestId('more-privacy'));
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-version')).toHaveTextContent('Wersja 0.4.0 (kompilacja 7)');
    expect(screen.getByTestId('privacy-last-sync')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('privacy-help-back'));
    expect(screen.queryByTestId('privacy-help')).toBeNull();
    await fireEvent.press(screen.getByTestId('more-help'));
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
    expect(screen.getByTestId('privacy-technical')).toBeOnTheScreen();
  });

  it('EVM-102 AC2: the screen works in the hidden-data mode and renders no data of the user', async () => {
    const rig = withOffice(stubPorts());
    rig.device.facts.secure = false;
    await open(rig);
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    await fireEvent.press(screen.getByTestId('more-privacy'));
    expect(screen.getByTestId('privacy-help')).toBeOnTheScreen();
    expect(screen.queryByText('Piotr Testowy')).toBeNull();
  });
});
