import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ContactConfig } from '../config/contact-values';
import { formatDateTime } from '../i18n/format';
import { ADMINISTRATOR, CLAUSES, type Clause, type ClauseBlock } from '../privacy/content';
import { LICENSES } from '../privacy/licenses';
import { AppBar, BackButton, Button, CircleAlert, Disclosure, InlineAlert } from '../ui';
import { color, space, text } from '../ui/theme';

/** The section the entry opens (anchors `#pomoc` and `#prywatnosc` of M-11): "Pomoc" or "Prywatność". */
export type HelpSection = 'help' | 'privacy';

export interface PrivacyHelpScreenProps {
  /** The section to scroll to and to move the reader focus to. */
  section: HelpSection;
  contact: ContactConfig;
  version: string;
  /** The build number of the package; `null` when the platform gives none. */
  build: string | null;
  /** The last successful synchronization: a time, `null` = none yet, `undefined` = not signed in (the row is not shown). */
  lastSyncAt: number | null | undefined;
  onBack: () => void;
  /** Opens `mailto:` / `tel:`; a rejection means that there is no program for it (never a report anywhere). */
  openUrl: (url: string) => Promise<void>;
  /** Puts the address on the clipboard; `false` when it could not be done. */
  copy: (value: string) => boolean;
}

type Notice = 'none' | 'mailFailed' | 'callFailed' | 'copied' | 'copyFailed';

function ClauseText({ block }: { block: ClauseBlock }) {
  if (block.kind === 'heading') {
    return (
      <Text accessibilityRole="header" style={{ ...text.labelLg, color: color.text.primary }}>
        {block.text}
      </Text>
    );
  }
  if (block.kind === 'paragraph') return <Text style={{ ...text.body, color: color.text.primary }}>{block.text}</Text>;
  return (
    <View style={{ rowGap: space.stack.xs }}>
      {block.items.map((item) => (
        <Text key={item} style={{ ...text.body, color: color.text.primary }}>
          {`•  ${item}`}
        </Text>
      ))}
    </View>
  );
}

function ClauseDisclosure({ clause }: { clause: Clause }) {
  const { t } = useTranslation();
  return (
    <Disclosure
      title={clause.title}
      caption={t('privacy.privacySection.clauseCaption', { version: clause.version, date: clause.validFrom })}
      accessibilityLabel={t('privacy.privacySection.clauseA11y', { title: clause.title, version: clause.version })}
      testID={`privacy-clause-${clause.id}`}
    >
      {clause.blocks.map((block, index) => (
        <ClauseText key={`${clause.id}-${String(index)}`} block={block} />
      ))}
    </Disclosure>
  );
}

/**
 * M-11 "Prywatność i pomoc" (EVM-102; UX flow 16): a static overlay (no router) for everybody, also offline, before the sign-in, in the
 * hidden-data mode and for the read-only role — it renders no data of the user and makes no request. The clauses are the shared source
 * of the panel W-19 (src/privacy/content.ts); the contact comes from the build. The entry sets the starting section and moves the reader
 * focus to its heading. Mail and phone fail softly: the address stays visible with "Kopiuj adres", nothing is reported.
 */
export function PrivacyHelpScreen({ section, contact, version, build, lastSyncAt, onBack, openUrl, copy }: PrivacyHelpScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  const headings = useRef<Record<HelpSection, ComponentRef<typeof Text> | null>>({ help: null, privacy: null });
  const offsets = useRef<Partial<Record<HelpSection, number>>>({});
  const arrived = useRef(false);
  const [notice, setNotice] = useState<Notice>('none');

  const arrive = useCallback(() => {
    const y = offsets.current[section];
    if (arrived.current || y === undefined) return;
    arrived.current = true;
    scroll.current?.scrollTo({ y, animated: false });
    const heading = headings.current[section];
    if (heading !== null) AccessibilityInfo.sendAccessibilityEvent(heading, 'focus');
  }, [section]);
  useEffect(() => {
    arrive();
  }, [arrive]);

  const measure = (name: HelpSection) => (event: { nativeEvent: { layout: { y: number } } }) => {
    offsets.current[name] = event.nativeEvent.layout.y;
    arrive();
  };

  const email = contact.email;
  const phone = contact.phone;
  const writeToOffice = () => {
    if (email === null) return;
    openUrl(`mailto:${email}`).then(
      () => {
        setNotice('none');
      },
      () => {
        setNotice('mailFailed');
      },
    );
  };
  const callOffice = () => {
    if (phone === null) return;
    openUrl(`tel:${phone.replace(/[ -]/g, '')}`).then(
      () => {
        setNotice('none');
      },
      () => {
        setNotice('callFailed');
      },
    );
  };
  const copyAddress = () => {
    if (email === null) return;
    setNotice(copy(email) ? 'copied' : 'copyFailed');
  };

  const administrator = [
    ['privacy.privacySection.adminName', ADMINISTRATOR.name],
    ['privacy.privacySection.adminLegalForm', ADMINISTRATOR.legalForm],
    ['privacy.privacySection.adminRegistry', ADMINISTRATOR.registry],
    ['privacy.privacySection.adminAddress', ADMINISTRATOR.address],
    ['privacy.privacySection.adminContact', ADMINISTRATOR.dataContact],
  ] as const;

  return (
    <View
      style={{ flex: 1, backgroundColor: color.bg.canvas, paddingBottom: insets.bottom }}
      testID="privacy-help"
      accessibilityViewIsModal
    >
      <AppBar
        title={t('privacy.title')}
        left={<BackButton accessibilityLabel={t('privacy.backA11y')} onPress={onBack} testID="privacy-help-back" />}
      />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.lg }}>
        <View style={{ rowGap: space.stack.sm }} onLayout={measure('help')} testID="privacy-help-section-help">
          <Text
            ref={(node) => {
              headings.current.help = node;
            }}
            accessible
            accessibilityRole="header"
            style={{ ...text.heading3, color: color.text.primary }}
          >
            {t('privacy.help.title')}
          </Text>
          {email === null ? (
            <Text style={{ ...text.body, color: color.text.primary }} testID="privacy-no-contact">
              {t('privacy.help.noContact')}
            </Text>
          ) : (
            <>
              <Text style={{ ...text.body, color: color.text.primary }}>{t('privacy.help.contact')}</Text>
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  label={email}
                  accessibilityLabel={t('privacy.help.writeA11y', { email })}
                  variant="tertiary"
                  onPress={writeToOffice}
                  testID="privacy-email"
                />
              </View>
            </>
          )}
          {phone === null ? null : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                label={t('privacy.help.call')}
                accessibilityLabel={t('privacy.help.callA11y', { phone })}
                variant="tertiary"
                onPress={callOffice}
                testID="privacy-call"
              />
            </View>
          )}
          {notice === 'mailFailed' && email !== null ? (
            <InlineAlert
              tone="error"
              body={t('privacy.help.mailFailed')}
              code={t('privacy.help.address', { email })}
              action={
                <Button label={t('privacy.help.copyAddress')} variant="tertiary" onPress={copyAddress} testID="privacy-copy-address" />
              }
              testID="privacy-mail-failed"
            />
          ) : null}
          {notice === 'callFailed' && phone !== null ? (
            <InlineAlert tone="error" body={t('privacy.help.callFailed', { phone })} testID="privacy-call-failed" />
          ) : null}
          {notice === 'copied' ? <InlineAlert tone="info" body={t('privacy.help.copied')} testID="privacy-copied" /> : null}
          {notice === 'copyFailed' ? <InlineAlert tone="error" body={t('privacy.help.copyFailed')} testID="privacy-copy-failed" /> : null}
          <InlineAlert
            tone="info"
            icon={CircleAlert}
            title={t('privacy.help.lostTitle')}
            body={email === null ? t('privacy.help.lostWithoutAddress') : t('privacy.help.lostWithAddress', { email })}
            testID="privacy-lost"
          />
          <Text style={{ ...text.body, color: color.text.secondary }}>{t('privacy.help.lostNote')}</Text>
        </View>

        <View style={{ rowGap: space.stack.sm }} onLayout={measure('privacy')} testID="privacy-help-section-privacy">
          <Text
            ref={(node) => {
              headings.current.privacy = node;
            }}
            accessible
            accessibilityRole="header"
            style={{ ...text.heading3, color: color.text.primary }}
          >
            {t('privacy.privacySection.title')}
          </Text>
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('privacy.privacySection.administrator')}
          </Text>
          {administrator.map(([key, value]) => (
            <Text key={key} style={{ ...text.body, color: color.text.primary }}>
              {t(key, { value })}
            </Text>
          ))}
          {CLAUSES.map((clause) => (
            <ClauseDisclosure key={clause.id} clause={clause} />
          ))}
        </View>

        <View style={{ rowGap: space.stack.sm }}>
          <Text accessibilityRole="header" style={{ ...text.heading3, color: color.text.primary }}>
            {t('privacy.about.title')}
          </Text>
          <Text style={{ ...text.body, color: color.text.primary }} testID="privacy-version">
            {build === null ? t('privacy.about.versionNoBuild', { version }) : t('privacy.about.version', { version, build })}
          </Text>
          {lastSyncAt === undefined ? null : (
            <Text style={{ ...text.body, color: color.text.primary }} testID="privacy-last-sync">
              {lastSyncAt === null ? t('privacy.about.lastSyncNone') : t('privacy.about.lastSync', { time: formatDateTime(lastSyncAt) })}
            </Text>
          )}
          <Text style={{ ...text.body, color: color.text.primary }} testID="privacy-technical">
            {t('privacy.about.technical')}
          </Text>
          <Disclosure title={t('privacy.about.licenses')} accessibilityLabel={t('privacy.about.licensesA11y')} testID="privacy-licenses">
            <Text style={{ ...text.body, color: color.text.secondary }}>{t('privacy.about.licensesIntro')}</Text>
            {LICENSES.map((entry) => (
              <Text key={entry.name} style={{ ...text.body, color: color.text.primary }}>
                {t('privacy.about.licenseLine', { name: entry.name, license: entry.license })}
              </Text>
            ))}
          </Disclosure>
        </View>
      </ScrollView>
    </View>
  );
}
