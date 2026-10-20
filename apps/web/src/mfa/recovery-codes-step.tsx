import { generateRecoveryCodes } from '@evia/contracts';
import { Banner, Button, Card, Checkbox, FieldError, InlineAlert, Info, Skeleton, TriangleAlert } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useStepUp } from '../session/step-up-context.tsx';

type Failure = 'failed' | 'cancelled' | 'unavailable';
type Copy = 'idle' | 'copied' | 'failed';

/** Thrown when the person cancels the confirmation of identity that the generation asked for. */
class StepUpCancelled extends Error {}

/** The code in groups of five (easier to write down); spaces and hyphens do not matter at the login. */
const grouped = (code: string): string => code.replace(/(.{5})(?=.)/g, '$1 ');

/**
 * W-03 step 3, "Kody odzyskiwania" (EVM-023 AC4; SR-AUTH-08): ten codes of 20 characters, shown once (there is no operation that
 * reads them again), "Kopiuj kody" and "Drukuj kody", the warning about the phone, a summary of the methods and the checkbox
 * "Kody są zapisane w bezpiecznym miejscu" that "Zakończ konfigurację" needs. The codes live in the state of this component
 * only (the memory of the tab) — never in storage, the address, the console or the query cache (`gcTime: 0`) — and are gone with
 * the step. After a passkey the session has no fresh confirmation yet, so the server asks for a step-up (W-04) and the request
 * is sent again; after the code of the app the window is open. A visit of the step makes new codes (the old ones stop working).
 */
export function RecoveryCodesStep({
  variant,
  role,
  online,
  headingRef,
  onFinish,
}: {
  readonly variant: 'passkey' | 'totp';
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly online: boolean;
  readonly headingRef: Ref<HTMLHeadingElement>;
  /** "Zakończ konfigurację" with the box ticked. */
  readonly onFinish: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const requestStepUp = useStepUp();
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [copy, setCopy] = useState<Copy>('idle');

  const generate = useMutation({
    gcTime: 0,
    mutationFn: async (): Promise<readonly string[]> => {
      const attempt = async () => (await unwrap(generateRecoveryCodes({ client }))).codes;
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 403 && error.code === 'step_up_required')) throw error;
        // A passkey does not open the window (EVM-029): the person confirms with it now, then the request goes again.
        if (!(await requestStepUp(t('stepUp.title.recoveryCodes'), [], ['passkey']))) throw new StepUpCancelled();
        return attempt();
      }
    },
    onSuccess: (result) => {
      setCodes(result);
    },
  });
  const started = useRef(false);
  useEffect(() => {
    // One generation per visit of the step: a second call would replace the codes the person is just looking at.
    if (started.current) return;
    started.current = true;
    generate.mutate();
  }, [generate]);

  const failure: Failure | null = !generate.isError
    ? null
    : generate.error instanceof StepUpCancelled
      ? 'cancelled'
      : generate.error instanceof ApiError &&
          generate.error.status === 403 &&
          generate.error.code === 'recovery_codes_regeneration_unavailable'
        ? 'unavailable'
        : 'failed';

  const copyCodes = async () => {
    try {
      await globalThis.navigator.clipboard.writeText((codes ?? []).join('\n'));
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
    // Nothing of the codes stays after the step.
    setCodes(null);
    onFinish();
  };

  return (
    <section className="flex w-full flex-col gap-stack-md">
      <h2 ref={headingRef} tabIndex={-1} className="text-heading-3 focus-visible:focus-ring">
        {t('mfa.codes.title')}
      </h2>
      <p className="text-body">{t('mfa.codes.description')}</p>
      {failure === null ? null : (
        <InlineAlert
          tone="error"
          action={
            failure === 'unavailable' ? undefined : (
              <Button
                variant="tertiary"
                disabled={!online}
                onClick={() => {
                  generate.mutate();
                }}
              >
                {t('mfa.codes.retry')}
              </Button>
            )
          }
        >
          {failure === 'cancelled'
            ? t('mfa.codes.cancelled')
            : failure === 'unavailable'
              ? t('mfa.codes.unavailable')
              : t('mfa.codes.failed')}
        </InlineAlert>
      )}
      {codes === null && failure === null ? (
        <div aria-busy="true" className="flex flex-col gap-stack-sm">
          <p role="status" className="text-body text-text-secondary">
            {t('mfa.codes.loading')}
          </p>
          <Skeleton />
          <Skeleton />
          <Skeleton className="w-1/2" />
        </div>
      ) : null}
      {codes === null ? null : (
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
          <p className="text-body">{variant === 'passkey' ? t('mfa.codes.methodsPasskey') : t('mfa.codes.methodsTotp')}</p>
          {variant === 'passkey' && role !== 'read_only' ? (
            <Banner icon={Info} tone="info">
              {t('mfa.codes.phone')}
            </Banner>
          ) : null}
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
            <Button size="lg" disabled={!online} onClick={finish}>
              {t('mfa.codes.finish')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
