import type { SiteType, WorkOrderTemplate } from '@evia/contracts';
import { Button, Card, Disclosure, InlineAlert, SelectableCardGroup, Skeleton, type SelectableCardOption } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { EMPTY_CHOICE, pluralForm } from './order-form.ts';

export interface TemplateSectionProps {
  readonly templates: UseQueryResult<WorkOrderTemplate[]>;
  /** The type of the object of the chosen or typed location; `undefined` until there is one (then no filter). */
  readonly siteType: SiteType | undefined;
  readonly showAll: boolean;
  readonly onShowAll: (showAll: boolean) => void;
  readonly choice: string;
  readonly onChoose: (choice: string, template: WorkOrderTemplate | undefined) => void;
  readonly error: string | undefined;
  /** The template was retired while the form was being filled in (`422 template_unavailable`): the alert stands by the section. */
  readonly unavailable: string | null;
  readonly unavailableRef: Ref<HTMLDivElement>;
  readonly firstRadioRef: Ref<HTMLInputElement>;
  /** The window is at `breakpoint.expanded` or wider: the page shows the preview on the right, so there is no Disclosure here. */
  readonly expanded: boolean;
}

/** "9 pozycji" — the count of the scope items with the Polish form of the word (§ 6.3). */
export function useItemsText(): (count: number) => string {
  const { t } = useTranslation();
  return (count) => {
    switch (pluralForm(count)) {
      case 'one':
        return t('newWorkOrder.template.itemsOne', { count });
      case 'few':
        return t('newWorkOrder.template.itemsFew', { count });
      case 'many':
        return t('newWorkOrder.template.itemsMany', { count });
    }
  };
}

/** "9 procesów" — the count of the processes of a template with the Polish form of the word (§ 6.3). */
export function useProcessesText(): (count: number) => string {
  const { t } = useTranslation();
  return (count) => {
    switch (pluralForm(count)) {
      case 'one':
        return t('newWorkOrder.template.processesOne', { count });
      case 'few':
        return t('newWorkOrder.template.processesFew', { count });
      case 'many':
        return t('newWorkOrder.template.processesMany', { count });
    }
  };
}

/** "7 etapów" — the count of the stages of a process of a template. */
function useStagesText(): (count: number) => string {
  const { t } = useTranslation();
  return (count) => {
    switch (pluralForm(count)) {
      case 'one':
        return t('newWorkOrder.template.stagesOne', { count });
      case 'few':
        return t('newWorkOrder.template.stagesFew', { count });
      case 'many':
        return t('newWorkOrder.template.stagesMany', { count });
    }
  };
}

/**
 * W-05 "3. Szablon" (EVM-022 AC1–AC3, AC8): cards of the active templates (SelectableCard, P-3) filtered by the type of the
 * object — "Pokaż wszystkie" takes the filter off — and the radio "Puste zlecenie (bez szablonu)". A card and the preview show
 * what the system creates in this version: the scope ("Zakres (9 pozycji)") and the processes ("9 pozycji · 9 procesów",
 * "Procesy (9)", EVM-031 AC1), without the payment plan (EVM-053). The preview stands on the right at `breakpoint.expanded` and in a Disclosure under the cards below it. Loading is
 * a skeleton of cards; names and texts are shown as React text only.
 */
export function TemplateSection({
  templates,
  siteType,
  showAll,
  onShowAll,
  choice,
  onChoose,
  error,
  unavailable,
  unavailableRef,
  firstRadioRef,
  expanded,
}: TemplateSectionProps) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  const processesText = useProcessesText();
  const [open, setOpen] = useState(false);
  const all = templates.data ?? [];
  const filtering = siteType !== undefined && !showAll;
  // A chosen template stays on the list even if the filter would hide it: the choice never disappears silently.
  const visible = filtering
    ? all.filter((entry) => entry.siteTypeHint === siteType || entry.siteTypeHint === null || entry.id === choice)
    : all;
  const chosen = all.find((entry) => entry.id === choice);

  const options: SelectableCardOption[] = [
    ...visible.map((entry) => ({
      value: entry.id,
      title: entry.name,
      description:
        entry.procedures.length === 0
          ? itemsText(entry.items.length)
          : t('newWorkOrder.template.cardDescription', {
              items: itemsText(entry.items.length),
              processes: processesText(entry.procedures.length),
            }),
    })),
    { value: EMPTY_CHOICE, title: t('newWorkOrder.template.empty') },
  ];

  let intro: string | null = null;
  if (templates.isSuccess && all.length > 0) {
    intro = filtering ? t('newWorkOrder.template.forType', { type: siteTypeLabels[siteType] }) : t('newWorkOrder.template.forAll');
  }

  return (
    <div className="flex flex-col gap-stack-md">
      <div className="flex flex-col gap-stack-md">
        {intro === null ? null : (
          <div className="flex flex-wrap items-center justify-between gap-inline-md">
            <p className="text-body text-text-secondary">{intro}</p>
            {siteType === undefined ? null : (
              <Button
                variant="tertiary"
                onClick={() => {
                  onShowAll(!showAll);
                }}
              >
                {showAll ? t('newWorkOrder.template.showForType') : t('newWorkOrder.template.showAll')}
              </Button>
            )}
          </div>
        )}
        {unavailable === null ? null : (
          <InlineAlert tone="error" alertRef={unavailableRef}>
            {unavailable}
          </InlineAlert>
        )}
        {templates.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-stack-sm">
            <p className="sr-only" role="status">
              {t('newWorkOrder.template.loading')}
            </p>
            <Skeleton shape="field" />
            <Skeleton shape="field" />
            <Skeleton shape="field" />
          </div>
        ) : (
          <>
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
                    {t('newWorkOrder.template.retry')}
                  </Button>
                }
              >
                {t('newWorkOrder.template.error')}
              </InlineAlert>
            ) : null}
            {templates.isSuccess && all.length === 0 ? (
              <p className="text-body text-text-secondary">{t('newWorkOrder.template.none')}</p>
            ) : null}
            {templates.isSuccess && all.length > 0 && visible.length === 0 ? (
              <p className="text-body text-text-secondary">{t('newWorkOrder.template.noneForType')}</p>
            ) : null}
            <SelectableCardGroup
              legend={t('newWorkOrder.template.legend')}
              options={options}
              value={choice}
              onChange={(value) => {
                onChoose(
                  value,
                  all.find((entry) => entry.id === value),
                );
              }}
              {...(error === undefined ? {} : { error })}
              firstRadioRef={firstRadioRef}
            />
          </>
        )}
        {expanded || chosen === undefined ? null : (
          <Disclosure title={t('newWorkOrder.template.previewToggle')} expanded={open} onExpandedChange={setOpen}>
            <TemplatePreview template={chosen} />
          </Disclosure>
        )}
      </div>
    </div>
  );
}

/** The preview of a template: its name, the type of the object, the scope and the processes with their stages — nothing the system does not create yet. */
export function TemplatePreview({ template, card = false }: { readonly template: WorkOrderTemplate; readonly card?: boolean }) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  const stagesText = useStagesText();
  const body = (
    <>
      <h3 className="text-heading-4 text-text-primary">{card ? t('newWorkOrder.template.previewTitle') : template.name}</h3>
      {card ? <p className="text-label-lg text-text-primary">{template.name}</p> : null}
      {template.siteTypeHint === null ? null : (
        <p className="text-body-sm text-text-secondary">
          {t('newWorkOrder.template.previewType', { type: siteTypeLabels[template.siteTypeHint] })}
        </p>
      )}
      <h4 className="text-label text-text-primary">
        {t('newWorkOrder.template.previewScope', { items: itemsText(template.items.length) })}
      </h4>
      <ul className="flex list-disc flex-col gap-stack-xs ps-inset-lg text-body-sm text-text-secondary">
        {[...template.items]
          .sort((a, b) => a.position - b.position)
          .map((item) => (
            <li key={item.code}>{item.name}</li>
          ))}
      </ul>
      {template.procedures.length === 0 ? null : (
        <>
          <h4 className="text-label text-text-primary">
            {t('newWorkOrder.template.previewProcedures', { count: template.procedures.length })}
          </h4>
          <ul className="flex list-disc flex-col gap-stack-xs ps-inset-lg text-body-sm text-text-secondary">
            {template.procedures.map((procedure) => (
              <li key={procedure.code}>
                {t('newWorkOrder.template.previewProcedure', { name: procedure.name, stages: stagesText(procedure.stageCount) })}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
  return card ? <Card>{body}</Card> : <div className="flex flex-col gap-stack-sm">{body}</div>;
}
