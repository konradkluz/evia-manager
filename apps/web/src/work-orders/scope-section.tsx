import type { ScopeItem, ScopeItemList } from '@evia/contracts';
import { List, ListItem, StatusBadge } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { describeParameters } from '../i18n/parameter-labels.ts';
import { SectionError, SectionLoading } from './section-states.tsx';
import { useItemsText } from './template-section.tsx';

/**
 * The section "Zakres (9 pozycji)" of W-06 (EVM-018 AC2, AC7): every item with its name and its technical parameters in Polish
 * ("AC, 11 kW, 3 fazy"). A set, a key or a value this panel does not know is the badge of an unknown value (P-12) — the raw value
 * is never shown. Names are free text of the catalogue and are rendered as React text. An order without items says so.
 * "Edytuj zakres" is EVM-035 and is not shown.
 */
export function ScopeSection({ query }: { readonly query: UseQueryResult<ScopeItemList> }) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  const headingId = useId();
  const items = query.data?.items;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {items === undefined ? t('workOrder.scope.title') : t('workOrder.scope.heading', { items: itemsText(items.length) })}
      </h2>
      {items !== undefined ? (
        items.length === 0 ? (
          <p className="text-body text-text-secondary">{t('workOrder.scope.empty')}</p>
        ) : (
          <List labelledBy={headingId}>
            {items.map((item) => (
              <ListItem key={item.id}>
                <ScopeLine item={item} />
              </ListItem>
            ))}
          </List>
        )
      ) : query.isError ? (
        <SectionError
          message={t('workOrder.scope.error')}
          retryLabel={t('workOrder.scope.retry')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <SectionLoading lines={4} />
      )}
    </section>
  );
}

function ScopeLine({ item }: { readonly item: ScopeItem }) {
  const { t } = useTranslation();
  const parts = describeParameters(item.parameterSetCode, item.parameters);
  const text = parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(', ');
  const unknown = parts.some((part) => part.kind === 'unknown');
  return (
    <>
      <span className="break-words text-body text-text-primary">{item.name}</span>
      {parts.length === 0 && item.quantity === 1 ? null : (
        <span className="flex flex-wrap items-center gap-inline-sm text-body-sm text-text-secondary">
          {text === '' ? null : <span className="break-words">{text}</span>}
          {unknown ? (
            <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
          ) : null}
          {item.quantity === 1 ? null : <span>{t('workOrder.scope.quantity', { value: item.quantity })}</span>}
        </span>
      )}
    </>
  );
}
