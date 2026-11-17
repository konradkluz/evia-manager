import { Button, type ButtonProps } from '@evia/ui-web';
import { useId } from 'react';

/**
 * A button that is disabled with a reason (styleguide § 4.13; flows/17 "Disabled z podpowiedzią"): the button stays focusable
 * (`aria-disabled`), keeps its own name ("Dodaj transzę") and the reason is its accessible description (`aria-describedby`) and
 * visible text under it — the reason is never only a tooltip, and never only a colour. Without a `hint` it is a plain button.
 */
export function HintedButton({ hint, ...rest }: ButtonProps & { readonly hint?: string | undefined }) {
  const id = useId();
  if (hint === undefined) return <Button {...rest} />;
  return (
    <span className="inline-flex flex-col items-start gap-stack-xs">
      <Button {...rest} disabled aria-describedby={id} />
      <span id={id} className="text-body-sm text-text-secondary">
        {hint}
      </span>
    </span>
  );
}
