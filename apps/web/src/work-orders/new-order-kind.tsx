import { SelectableCardGroup } from '@evia/ui-web';
import { useEffect, useRef } from 'react';
import { newSurveyText } from './new-survey-labels.ts';

export type OrderKind = 'order' | 'survey';

export interface OrderKindChoiceProps {
  readonly kind: OrderKind;
  readonly onChange: (kind: OrderKind) => void;
  /** The form below was just replaced by the other kind: the chosen card takes the focus back (it was in the form that is gone). */
  readonly restoreFocus?: boolean;
}

/**
 * The choice "Rodzaj" at the top of W-05 (EVM-138 AC2; flows/17 → W-05): "Zlecenie z szablonu" (the form of EVM-020…022) or "Wizja lokalna".
 * Two selectable cards as one radio group (arrows move the choice, § 3.22). It exists only while the server has the function on
 * (`features.siteSurveys`) and only for the Administrator and the Editor. The page announces the change ("Formularz wizji lokalnej")
 * and the focus stays on the chosen card. The address carries only the kind (`?rodzaj=wizja`), never a value of the form.
 */
export function OrderKindChoice({ kind, onChange, restoreFocus = false }: OrderKindChoiceProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (restoreFocus) root.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    // Only a mount of a form that replaced the other one matters; typing in the form never moves the focus here.
  }, [restoreFocus]);
  return (
    <div ref={root}>
      <SelectableCardGroup
        legend={newSurveyText.kindLegend}
        value={kind}
        onChange={(value) => {
          onChange(value === 'survey' ? 'survey' : 'order');
        }}
        options={[
          { value: 'order', title: newSurveyText.kindOrder, description: newSurveyText.kindOrderHint },
          { value: 'survey', title: newSurveyText.kindSurvey, description: newSurveyText.kindSurveyHint },
        ]}
      />
    </div>
  );
}
