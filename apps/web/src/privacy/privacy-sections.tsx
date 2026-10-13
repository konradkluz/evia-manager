import { Banner, Card, Disclosure, InlineAlert, TextLink, TriangleAlert } from '@evia/ui-web';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIVACY_ANCHORS } from '../paths.ts';
import { mailtoHref } from '../work-orders/safe-href.ts';
import { ADMINISTRATOR, CLAUSES, CONTACT_EMAIL, DRAFT, type Clause, type ClauseBlock } from './content.ts';

const HELP_ID = 'pomoc';
const PRIVACY_ID = 'prywatnosc';
/** The anchor of a section moves focus to its heading; scroll margin keeps it clear of the top edge (WCAG 2.4.11). */
const SECTION_HEADING = 'font-display text-heading-2 text-text-primary scroll-mt-app-bar-height-web focus-visible:focus-ring';

/** Content blocks are plain data (heading, paragraph, list) rendered as elements — never HTML or Markdown (SR-WEB-03). */
function Block({ block }: { readonly block: ClauseBlock }) {
  switch (block.kind) {
    case 'heading':
      return <h4 className="text-label-lg font-semibold text-text-primary">{block.text}</h4>;
    case 'paragraph':
      return <p className="text-body text-text-primary">{block.text}</p>;
    case 'list':
      return (
        <ul className="flex flex-col gap-stack-xs ps-inset-lg list-disc text-body text-text-primary">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
  }
}

function ClauseBody({ clause }: { readonly clause: Clause }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <Disclosure
      title={clause.title}
      summary={t('privacy.privacy.version', { version: clause.version, date: clause.validFrom })}
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      {clause.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </Disclosure>
  );
}

/** A function address as an element: the link text is the address; the accessible name starts with it (WCAG 2.5.3). */
function MailLink({ href, address }: { readonly href: string; readonly address: string }) {
  const { t } = useTranslation();
  return (
    <TextLink href={href}>
      {address} <span className="sr-only">{t('privacy.help.mailSuffix')}</span>
    </TextLink>
  );
}

function Help(): ReactNode {
  const { t } = useTranslation();
  const href = CONTACT_EMAIL === null ? undefined : mailtoHref(CONTACT_EMAIL);
  const link = href === undefined || CONTACT_EMAIL === null ? null : <MailLink href={href} address={CONTACT_EMAIL} />;
  return (
    <Card labelledBy={HELP_ID}>
      <h2 id={HELP_ID} tabIndex={-1} className={SECTION_HEADING}>
        {t('privacy.help.title')}
      </h2>
      <p className="text-body">
        {link === null ? (
          t('privacy.help.contactMissing')
        ) : (
          <>
            {t('privacy.help.contact')} {link}
          </>
        )}
      </p>
      <Banner icon={TriangleAlert} tone="warning" label={t('privacy.help.lossLabel')}>
        <p>
          {link === null ? (
            t('privacy.help.lossMissing')
          ) : (
            <>
              {t('privacy.help.loss')} {link}
            </>
          )}
        </p>
      </Banner>
    </Card>
  );
}

function Privacy(): ReactNode {
  const { t } = useTranslation();
  const rows = [
    [t('privacy.privacy.name'), ADMINISTRATOR.name],
    [t('privacy.privacy.legalForm'), ADMINISTRATOR.legalForm],
    [t('privacy.privacy.registry'), ADMINISTRATOR.registry],
    [t('privacy.privacy.address'), ADMINISTRATOR.address],
    [t('privacy.privacy.dataContact'), ADMINISTRATOR.dataContact],
  ] as const;
  return (
    <Card labelledBy={PRIVACY_ID}>
      <h2 id={PRIVACY_ID} tabIndex={-1} className={SECTION_HEADING}>
        {t('privacy.privacy.title')}
      </h2>
      {DRAFT ? <InlineAlert tone="info">{t('privacy.privacy.draft')}</InlineAlert> : null}
      <section aria-labelledby="administrator" className="flex flex-col gap-stack-sm">
        <h3 id="administrator" className="text-heading-4 text-text-primary">
          {t('privacy.privacy.administrator')}
        </h3>
        <dl className="flex flex-col gap-stack-xs text-body">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-inline-sm">
              <dt className="text-text-secondary">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {CLAUSES.map((clause) => (
        <ClauseBody key={clause.id} clause={clause} />
      ))}
    </Card>
  );
}

/**
 * The body of W-19 (a separate chunk, loaded by the page): "Pomoc" first and in the same place with and without a session
 * (WCAG 3.2.3, 3.2.6), then "Prywatność" with the controller and the clauses. An address with `#pomoc` or `#prywatnosc`
 * moves focus to that heading; any other fragment is ignored (a whitelist, no selector built from the address — CWE-20).
 * Nothing here is written to the storage of the browser, not even which clause is open (SR-WEB-05).
 */
export default function PrivacySections() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (PRIVACY_ANCHORS.includes(hash)) document.getElementById(hash)?.focus();
  }, [hash]);
  return (
    <div className="flex flex-col gap-stack-lg">
      <Help />
      <Privacy />
    </div>
  );
}
