import type { SiteType } from '@evia/contracts';
import { Button, ChevronDown, ChevronUp, InlineAlert, Select, type SelectOption } from '@evia/ui-web';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { moreFiltersCount } from './filters.ts';
import { useTemplates } from './use-order-lookups.ts';

export interface WorkOrderMoreFiltersProps {
  readonly siteType: SiteType | '';
  readonly templateId: string;
  readonly open: boolean;
  /** Offline: the panel is disabled like the rest of the filters. */
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (next: { readonly siteType: SiteType | ''; readonly templateId: string }) => void;
}

const SITE_TYPES = Object.keys(siteTypeLabels) as SiteType[];

/**
 * The panel "Więcej filtrów" (styleguide § 3.7; EVM-072 AC4): the button with `aria-expanded` and `aria-controls` that shows the
 * number of filters on, and under it — inside the bar, without a dialog — "Typ obiektu" (labels of `SiteType`) and "Szablon"
 * (templates of work orders). A choice works at once ("Zastosuj" does not exist on the web). Both filters live only in the memory
 * of the tab. When the list of templates cannot be read the select says so and offers a retry; the other filters keep working.
 */
export function WorkOrderMoreFilters({ siteType, templateId, open, disabled, onOpenChange, onChange }: WorkOrderMoreFiltersProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const count = moreFiltersCount({ siteType, templateId });
  // The templates are read when the panel is opened (or a chip needs a name); the set is small and comes whole.
  const templates = useTemplates(open || templateId !== '');
  const siteTypeOptions: SelectOption[] = [
    { value: '', label: t('workOrders.more.allSiteTypes') },
    ...SITE_TYPES.map((value) => ({ value, label: siteTypeLabels[value] })),
  ];
  const templateOptions: SelectOption[] = [
    { value: '', label: t('workOrders.more.allTemplates') },
    ...(templates.data ?? []).map((template) => ({ value: template.id, label: template.name })),
  ];
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <div className="flex flex-col gap-stack-sm">
      <div>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={panelId}
          {...(count > 0 ? { 'aria-describedby': `${panelId}-count` } : {})}
          onClick={() => {
            onOpenChange(!open);
          }}
        >
          {count > 0 ? t('workOrders.more.buttonCount', { count }) : t('workOrders.more.button')}
          <Chevron aria-hidden="true" className="size-icon-md shrink-0" />
        </Button>
        {count > 0 ? (
          <span id={`${panelId}-count`} className="sr-only">
            {t('workOrders.more.described', { count })}
          </span>
        ) : null}
      </div>
      <div
        id={panelId}
        role="group"
        aria-label={t('workOrders.more.title')}
        hidden={!open}
        className="flex flex-col gap-stack-md p-inset-md rounded-card bg-bg-surface-subtle"
      >
        <div className="grid grid-cols-1 items-start gap-inline-md medium:grid-cols-2">
          <Select
            label={t('workOrders.more.siteType')}
            value={siteType}
            options={siteTypeOptions}
            disabled={disabled}
            onChange={(value) => {
              onChange({ siteType: value as SiteType | '', templateId });
            }}
          />
          <Select
            label={t('workOrders.more.template')}
            value={templateId}
            options={templateOptions}
            disabled={disabled || templates.isError}
            {...(templates.isPending && open ? { hint: t('workOrders.more.templatesLoading') } : {})}
            onChange={(value) => {
              onChange({ siteType, templateId: value });
            }}
          />
        </div>
        {templates.isError ? (
          <InlineAlert
            tone="error"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void templates.refetch();
                }}
              >
                {t('workOrders.more.templatesRetry')}
              </Button>
            }
          >
            {t('workOrders.more.templatesError')}
          </InlineAlert>
        ) : null}
        <div>
          <Button
            variant="tertiary"
            disabled={disabled || count === 0}
            onClick={() => {
              onChange({ siteType: '', templateId: '' });
            }}
          >
            {t('workOrders.more.clear')}
          </Button>
        </div>
      </div>
    </div>
  );
}
