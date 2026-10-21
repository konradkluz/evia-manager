import { Banner, Button, Card, Checkbox, FieldError, TriangleAlert } from '@evia/ui-web';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Copy = 'idle' | 'copied' | 'failed';

/** The code in groups of five (easier to write down); spaces and hyphens do not matter at the login. */
const grouped = (code: string): string => code.replace(/(.{5})(?=.)/g, '$1 ');

/**
 * The ten recovery codes, shown once (EVM-023 AC4, EVM-028 AC5; SR-AUTH-08): the list for a screen reader, "Kopiuj kody", "Drukuj kody",
 * the warning about keeping them, an optional extra part (the summary of the methods of W-03) and the checkbox "Kody są zapisane w
 * bezpiecznym miejscu" that the finishing button needs. Shared by step 3 of W-03 and the dialog of new codes in W-15. The codes live
 * in the props (the memory of the tab) — never in storage, the address, the console or the query cache.
 */
export function RecoveryCodesView({
  codes,
  finishLabel,
  finishSize = 'md',
  online = true,
  extra,
  onFinish,
}: {
  readonly codes: readonly string[];
  readonly finishLabel: string;
  readonly finishSize?: 'md' | 'lg';
  readonly online?: boolean;
  /** Content between the warning and the checkbox. */
  readonly extra?: ReactNode;
  /** The box is ticked and the person finished. */
  readonly onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [copy, setCopy] = useState<Copy>('idle');

  const copyCodes = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(codes.join('\n'));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  const finish = () => {
    if (!saved) {
      setUnsaved(true);
      return;
    }
    onFinish();
  };

  return (
    <>
      <Card>
        <ul aria-label={t('mfa.codes.list')} className="grid grid-cols-1 gap-stack-sm medium:grid-cols-2">
          {codes.map((code) => (
            <li key={code} className="font-mono text-mono text-text-primary">
              {grouped(code)}
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-wrap items-center gap-inline-md">
        <Button
          variant="secondary"
          onClick={() => {
            void copyCodes();
          }}
        >
          {t('mfa.codes.copy')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            globalThis.print();
          }}
        >
          {t('mfa.codes.print')}
        </Button>
      </div>
      {copy === 'copied' ? (
        <p role="status" className="text-body-sm text-text-secondary">
          {t('mfa.codes.copied')}
        </p>
      ) : null}
      {copy === 'failed' ? <FieldError>{t('mfa.codes.copyFailed')}</FieldError> : null}
      <Banner icon={TriangleAlert}>{t('mfa.codes.warning')}</Banner>
      {extra}
      <Checkbox
        label={t('mfa.codes.saved')}
        checked={saved}
        onChange={(value) => {
          setSaved(value);
          if (value) setUnsaved(false);
        }}
      />
      {unsaved ? <FieldError>{t('mfa.codes.savedRequired')}</FieldError> : null}
      <div>
        <Button size={finishSize} disabled={!online} onClick={finish}>
          {finishLabel}
        </Button>
      </div>
    </>
  );
}
