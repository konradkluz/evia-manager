import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { pluralKey } from '../i18n/plural';
import {
  findSimilarCustomers,
  nameKey,
  phoneKey,
  type QuickCustomer,
  type QuickError,
  type QuickField,
  type QuickOrderDraft,
  type QuickOrderSource,
  type QuickSite,
} from '../orders/quick-order-model';
import { SITE_TYPES, isSiteType, type PhoneTemplate, type SiteType } from '../orders/templates';
import { PLURAL_KEYS, SITE_TYPE_KEYS } from './quick-order-text';
import { AlertDialog, Button, FilterChip, InlineAlert, SelectableCard, TextField } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';

export type Patch = Partial<QuickOrderDraft>;
export interface SectionProps {
  readonly draft: QuickOrderDraft;
  readonly source: QuickOrderSource;
  readonly set: (patch: Patch) => void;
  readonly errorOf: (field: QuickField) => string | undefined;
}

const SHOWN_MATCHES = 5;

function Heading({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
      {title}
    </Text>
  );
}

function Group({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.inline.sm }}
      testID={testID}
    >
      {children}
    </View>
  );
}

function ErrorLine({ message, testID }: { message: string | undefined; testID: string }) {
  if (message === undefined) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={{ ...text.bodySm, color: color.text.error }} testID={testID}>
      {message}
    </Text>
  );
}

/** Customers of the phone matching the typed search (name without Polish letters or case, or digits of the phone). */
function matchingCustomers(customers: readonly QuickCustomer[], query: string): readonly QuickCustomer[] {
  const wanted = nameKey(query);
  const digits = query.replace(/\D/gu, '');
  const found = customers.filter((customer) => {
    if (wanted === '') return true;
    if (nameKey(customer.displayName).includes(wanted)) return true;
    return digits.length >= 3 && (phoneKey(customer.phone) ?? '').includes(digits);
  });
  return found.slice(0, SHOWN_MATCHES);
}

function matchingSites(sites: readonly QuickSite[], query: string): readonly QuickSite[] {
  const wanted = nameKey(query);
  return sites
    .filter((site) => wanted === '' || nameKey(`${site.street} ${site.buildingNumber} ${site.city} ${site.postalCode}`).includes(wanted))
    .slice(0, SHOWN_MATCHES);
}

/** 1. "Klient": one of the phone or a new one (kind, name, phone) and the hint about a similar customer (AC2, AC3). */
export function CustomerSection({ draft, source, set, errorOf, similarAsk }: SectionProps & { similarAsk: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => matchingCustomers(source.customers, query), [source.customers, query]);
  const similar = useMemo(() => findSimilarCustomers(draft, source.customers), [draft, source.customers]);
  const hasPhoneCustomers = source.customers.length > 0;
  const person = draft.kind === 'person';
  return (
    <View style={{ rowGap: space.stack.sm }} testID="quick-customer">
      <Heading title={t('quickOrder.customer')} />
      {hasPhoneCustomers ? (
        <Group label={t('quickOrder.customer')}>
          <FilterChip
            radio
            label={t('quickOrder.fromPhone')}
            accessibilityLabel={t('quickOrder.fromPhone')}
            selected={draft.customerMode === 'existing'}
            onPress={() => {
              set({ customerMode: 'existing' });
            }}
            testID="quick-customer-existing"
          />
          <FilterChip
            radio
            label={t('quickOrder.newCustomer')}
            accessibilityLabel={t('quickOrder.newCustomer')}
            selected={draft.customerMode === 'new'}
            onPress={() => {
              set({ customerMode: 'new', customerId: null });
            }}
            testID="quick-customer-new"
          />
        </Group>
      ) : null}
      {draft.customerMode === 'existing' ? (
        <View style={{ rowGap: space.stack.sm }}>
          <TextField
            label={t('quickOrder.searchCustomer')}
            value={query}
            onChangeText={setQuery}
            privateData
            maxLength={100}
            testID="quick-customer-search"
          />
          <View accessibilityRole="radiogroup" accessibilityLabel={t('quickOrder.customer')} style={{ rowGap: space.stack.sm }}>
            {matches.length === 0 ? (
              <Text style={{ ...text.body, color: color.text.secondary }}>{t('quickOrder.customersNone')}</Text>
            ) : (
              matches.map((customer) => (
                <SelectableCard
                  key={customer.id}
                  title={customer.displayName}
                  description={customer.phone === '' ? undefined : customer.phone}
                  accessibilityLabel={[customer.displayName, customer.phone].filter((part) => part !== '').join(', ')}
                  selected={draft.customerId === customer.id}
                  onPress={() => {
                    set({ customerId: customer.id });
                  }}
                  testID={`quick-customer-pick-${customer.id}`}
                />
              ))
            )}
          </View>
          <ErrorLine message={errorOf('customer')} testID="quick-customer-error" />
        </View>
      ) : (
        <View style={{ rowGap: space.stack.sm }}>
          <Group label={t('quickOrder.customer')}>
            <FilterChip
              radio
              label={t('quickOrder.person')}
              accessibilityLabel={t('quickOrder.person')}
              selected={person}
              onPress={() => {
                set({ kind: 'person' });
              }}
              testID="quick-kind-person"
            />
            <FilterChip
              radio
              label={t('quickOrder.company')}
              accessibilityLabel={t('quickOrder.company')}
              selected={!person}
              onPress={() => {
                set({ kind: 'company' });
              }}
              testID="quick-kind-company"
            />
          </Group>
          {person ? (
            <>
              <TextField
                label={t('quickOrder.firstName')}
                value={draft.firstName}
                onChangeText={(firstName) => {
                  set({ firstName });
                }}
                privateData
                autoCapitalize="words"
                maxLength={100}
                {...errorProp(errorOf('firstName'))}
                testID="quick-first-name"
              />
              <TextField
                label={t('quickOrder.lastName')}
                value={draft.lastName}
                onChangeText={(lastName) => {
                  set({ lastName });
                }}
                privateData
                autoCapitalize="words"
                maxLength={100}
                {...errorProp(errorOf('lastName'))}
                testID="quick-last-name"
              />
            </>
          ) : (
            <TextField
              label={t('quickOrder.companyName')}
              value={draft.companyName}
              onChangeText={(companyName) => {
                set({ companyName });
              }}
              privateData
              autoCapitalize="words"
              maxLength={200}
              {...errorProp(errorOf('companyName'))}
              testID="quick-company-name"
            />
          )}
          <TextField
            label={t('quickOrder.phone')}
            value={draft.phone}
            onChangeText={(phone) => {
              set({ phone });
            }}
            privateData
            keyboardType="phone-pad"
            maxLength={40}
            {...errorProp(errorOf('phone'))}
            testID="quick-phone"
          />
          {similar.map((customer) => (
            <InlineAlert
              key={customer.id}
              tone="info"
              body={t('quickOrder.similar', { name: customer.displayName, phone: customer.phone })}
              {...(similarAsk ? { title: t('quickOrder.similarConfirm') } : {})}
              action={
                <Button
                  variant="tertiary"
                  label={t('quickOrder.similarPick')}
                  accessibilityLabel={t('quickOrder.similarPickA11y', { name: customer.displayName })}
                  onPress={() => {
                    set({ customerMode: 'existing', customerId: customer.id });
                  }}
                  testID={`quick-similar-pick-${customer.id}`}
                />
              }
              testID={`quick-similar-${customer.id}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** An optional `error` prop (the library takes `undefined` as "no error", but never an explicit `undefined` under exactOptionalPropertyTypes). */
export const errorProp = (message: string | undefined): { error?: string } => (message === undefined ? {} : { error: message });

/** The button that opens the list of the types of a site; the list is a dialog drawn by the screen, not inside the scroll. */
function SiteTypeSelect({ value, error, onOpen }: { value: SiteType | null; error: string | undefined; onOpen: () => void }) {
  const { t } = useTranslation();
  const label = value === null ? null : t(SITE_TYPE_KEYS[value]);
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('quickOrder.siteType')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quickOrder.siteTypeA11y', { value: label ?? t('quickOrder.siteTypeChoose') })}
        onPress={onOpen}
        testID="quick-site-type"
        style={({ pressed }) => ({
          minHeight: size.control.height.mobile.md,
          justifyContent: 'center',
          paddingHorizontal: space.inset.md,
          borderRadius: radius.control,
          borderWidth: error === undefined ? borderWidth.default : borderWidth.strong,
          borderColor: error === undefined ? color.border.strong : color.border.error,
          backgroundColor: pressed ? color.bg.surfacePressed : color.control.bg,
        })}
      >
        <Text style={{ ...text.body, color: label === null ? color.control.placeholder : color.text.primary }}>
          {label ?? t('quickOrder.siteTypeChoose')}
        </Text>
      </Pressable>
      <ErrorLine message={error} testID="quick-site-type-error" />
    </View>
  );
}

/** The list of the types of a site (a dialog, like the stage list of the entry form). */
export function SiteTypeDialog({ onPick, onCancel }: { onPick: (value: SiteType) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      title={t('quickOrder.siteTypeDialogTitle')}
      onCancel={onCancel}
      testID="quick-site-type-dialog"
      actions={
        <Button variant="tertiary" label={t('quickOrder.siteTypeCancel')} onPress={onCancel} fullWidth testID="quick-site-type-cancel" />
      }
    >
      <View style={{ rowGap: space.stack.xs }}>
        {SITE_TYPES.map((value) => (
          <Button
            key={value}
            variant="tertiary"
            label={t(SITE_TYPE_KEYS[value])}
            onPress={() => {
              onPick(value);
            }}
            fullWidth
            testID={`quick-site-type-${value}`}
          />
        ))}
      </View>
    </AlertDialog>
  );
}

const siteLine = (site: QuickSite): string =>
  [`${site.street} ${site.buildingNumber}`.trim(), site.apartmentNumber === '' ? '' : `/${site.apartmentNumber}`, `, ${site.city}`]
    .join('')
    .replace(/^, /u, '');

/** 2. "Lokalizacja": one of the phone or a new one (type, address, the number of the parking spot for a garage). */
export function SiteSection({ draft, source, set, errorOf, onOpenType }: SectionProps & { onOpenType: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => matchingSites(source.sites, query), [source.sites, query]);
  const hasPhoneSites = source.sites.length > 0;
  const garage = draft.siteType === 'multi_family_garage';
  return (
    <View style={{ rowGap: space.stack.sm }} testID="quick-site">
      <Heading title={t('quickOrder.site')} />
      {hasPhoneSites ? (
        <Group label={t('quickOrder.site')}>
          <FilterChip
            radio
            label={t('quickOrder.fromPhone')}
            accessibilityLabel={t('quickOrder.fromPhone')}
            selected={draft.siteMode === 'existing'}
            onPress={() => {
              set({ siteMode: 'existing' });
            }}
            testID="quick-site-existing"
          />
          <FilterChip
            radio
            label={t('quickOrder.newSite')}
            accessibilityLabel={t('quickOrder.newSite')}
            selected={draft.siteMode === 'new'}
            onPress={() => {
              set({ siteMode: 'new', siteId: null });
            }}
            testID="quick-site-new"
          />
        </Group>
      ) : null}
      {draft.siteMode === 'existing' ? (
        <View style={{ rowGap: space.stack.sm }}>
          <TextField
            label={t('quickOrder.searchSite')}
            value={query}
            onChangeText={setQuery}
            privateData
            maxLength={100}
            testID="quick-site-search"
          />
          <View accessibilityRole="radiogroup" accessibilityLabel={t('quickOrder.site')} style={{ rowGap: space.stack.sm }}>
            {matches.length === 0 ? (
              <Text style={{ ...text.body, color: color.text.secondary }}>{t('quickOrder.sitesNone')}</Text>
            ) : (
              matches.map((site) => (
                <SelectableCard
                  key={site.id}
                  title={siteLine(site)}
                  description={isSiteType(site.siteType) ? t(SITE_TYPE_KEYS[site.siteType]) : undefined}
                  accessibilityLabel={siteLine(site)}
                  selected={draft.siteId === site.id}
                  onPress={() => {
                    set({ siteId: site.id });
                  }}
                  testID={`quick-site-pick-${site.id}`}
                />
              ))
            )}
          </View>
          <ErrorLine message={errorOf('site')} testID="quick-site-error" />
        </View>
      ) : (
        <View style={{ rowGap: space.stack.sm }}>
          <SiteTypeSelect value={draft.siteType} error={errorOf('siteType')} onOpen={onOpenType} />
          <TextField
            label={t('quickOrder.street')}
            value={draft.street}
            onChangeText={(street) => {
              set({ street });
            }}
            privateData
            autoCapitalize="words"
            maxLength={200}
            {...errorProp(errorOf('street'))}
            testID="quick-street"
          />
          <TextField
            label={t('quickOrder.buildingNumber')}
            value={draft.buildingNumber}
            onChangeText={(buildingNumber) => {
              set({ buildingNumber });
            }}
            privateData
            maxLength={30}
            {...errorProp(errorOf('buildingNumber'))}
            testID="quick-building"
          />
          <TextField
            label={t('quickOrder.apartmentNumber')}
            value={draft.apartmentNumber}
            onChangeText={(apartmentNumber) => {
              set({ apartmentNumber });
            }}
            privateData
            maxLength={30}
            {...errorProp(errorOf('apartmentNumber'))}
            testID="quick-apartment"
          />
          <TextField
            label={t('quickOrder.postalCode')}
            value={draft.postalCode}
            onChangeText={(postalCode) => {
              set({ postalCode });
            }}
            privateData
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            {...errorProp(errorOf('postalCode'))}
            testID="quick-postal"
          />
          <TextField
            label={t('quickOrder.city')}
            value={draft.city}
            onChangeText={(city) => {
              set({ city });
            }}
            privateData
            autoCapitalize="words"
            maxLength={100}
            {...errorProp(errorOf('city'))}
            testID="quick-city"
          />
          {garage ? (
            <TextField
              label={t('quickOrder.parkingSpotNumber')}
              value={draft.parkingSpotNumber}
              onChangeText={(parkingSpotNumber) => {
                set({ parkingSpotNumber });
              }}
              privateData
              maxLength={30}
              {...errorProp(errorOf('parkingSpotNumber'))}
              testID="quick-spot"
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/** "3 pozycje · 1 proces · 1 transza" (styleguide § 3.22; Polish plural forms). */
export function templateDescription(template: PhoneTemplate, t: (key: string, options?: Record<string, unknown>) => string): string {
  const part = (n: number, keys: { readonly one: string; readonly few: string; readonly many: string }): string =>
    t(pluralKey(n, keys), { count: n });
  return [
    part(template.itemCount, PLURAL_KEYS.items),
    part(template.procedureCount, PLURAL_KEYS.procedures),
    part(template.milestoneCount, PLURAL_KEYS.milestones),
  ].join(' · ');
}

/** 3. "Szablon": the templates stored on the phone, filtered by the type of the site; "Pokaż wszystkie szablony" removes the filter. */
export function TemplateSection({
  templates,
  all,
  filtered,
  chosen,
  showAll,
  onShowAll,
  onPick,
  error,
}: {
  templates: readonly PhoneTemplate[];
  /** Whether the type of the site hides some templates ("Pokaż wszystkie" is offered only then). */
  filtered: boolean;
  all: number;
  chosen: string | null;
  showAll: boolean;
  onShowAll: () => void;
  onPick: (template: PhoneTemplate) => void;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ rowGap: space.stack.sm }} testID="quick-template">
      <Heading title={t('quickOrder.template')} />
      {all === 0 ? (
        <InlineAlert tone="info" body={t('quickOrder.noTemplates')} testID="quick-no-templates" />
      ) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('quickOrder.template')} style={{ rowGap: space.stack.sm }}>
          {templates.map((template) => {
            const description = templateDescription(template, t);
            return (
              <SelectableCard
                key={template.id}
                title={template.name}
                description={description}
                accessibilityLabel={t('quickOrder.templateA11y', { name: template.name, description })}
                selected={chosen === template.id}
                onPress={() => {
                  onPick(template);
                }}
                testID={`quick-template-${template.id}`}
              />
            );
          })}
        </View>
      )}
      {all > 0 && filtered ? (
        <Button
          variant="tertiary"
          label={showAll ? t('quickOrder.showFilteredTemplates') : t('quickOrder.showAllTemplates')}
          onPress={onShowAll}
          testID="quick-template-show-all"
        />
      ) : null}
      <ErrorLine message={error} testID="quick-template-error" />
    </View>
  );
}

/** The errors in the order of the form, for the summary at the top; the first one is the focus target. */
export function errorMessages(errors: readonly QuickError[], message: (error: QuickError) => string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const error of errors) {
    const line = message(error);
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}
