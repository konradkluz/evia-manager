import { startTotpEnrolment, type Account, type Passkey, type TotpSetup } from '@evia/contracts';
import { Banner, Button, Card, Dialog, InlineAlert, Info, KeyRound, List, ListItem, Plus, Smartphone, TriangleAlert } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { TotpEnrolment } from '../mfa/totp-enrolment.tsx';
import { setCsrfToken } from '../session/csrf.ts';
import { useToast } from '../shell/toast-context.tsx';
import { formatDate } from '../work-orders/format.ts';
import { describeAccountFailure, type AccountFailure } from './account-failure.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { AddPasskeyDialog } from './add-passkey-dialog.tsx';
import { NewRecoveryCodes } from './new-recovery-codes.tsx';
import { pluralOf } from './plural.ts';
import { ACCOUNT_KEY } from './query-keys.ts';
import { RemoveMethodDialog, type RemoveTarget } from './remove-method-dialog.tsx';
import { ReauthenticationCancelled, useReauthCall } from './use-reauth-call.ts';

type Role = Account['role'];
type Open =
  | { readonly kind: 'addPasskey' }
  | { readonly kind: 'remove'; readonly target: RemoveTarget }
  | { readonly kind: 'addTotp'; readonly setup: TotpSetup }
  | { readonly kind: 'codes' };

/** "Usuń…" is off for the last method (EVM-028 AC4): an Administrator keeps at least one passkey (a code of the app is not a method of the panel), the rest at least one method. */
export function lastMethodRule(role: Role, passkeys: number, totp: boolean): { readonly passkey: boolean; readonly totp: boolean } {
  if (role === 'administrator') return { passkey: passkeys <= 1, totp: false };
  const only = passkeys + (totp ? 1 : 0) <= 1;
  return { passkey: only, totp: only };
}

/**
 * W-15 "Drugi krok logowania" (EVM-028 AC3, AC4, AC5; SR-AUTH-10, SR-AUTH-15, SR-AUTH-08; anchor `#drugi-krok`): the passkeys with their
 * names and the date they were added, the code of the app, the recovery codes (how many are left, when they were made). Every change
 * needs the full re-authentication (W-04, each time; the server asks) and ends with an e-mail and an audit event (the server does it).
 * The rule of the last method is shown (the button is off with the reason) and enforced by the server. The page keeps nothing of the
 * secrets: the secret of a new code of the app is in the state of its dialog only.
 */
export function SecondStepCard({
  account,
  online,
  headingRef,
}: {
  readonly account: Account;
  readonly online: boolean;
  /** The anchor `#drugi-krok` puts the focus on the heading of this card. */
  readonly headingRef: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const id = useId();
  const { role } = account;
  const { passkeys, totp, recoveryCodes } = account.secondStep;
  const [open, setOpen] = useState<Open | null>(null);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const rule = lastMethodRule(role, passkeys.length, totp !== null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [ACCOUNT_KEY] });
  };
  const close = () => {
    setOpen(null);
  };
  const done = (message: string) => {
    setOpen(null);
    showToast(message);
    refresh();
  };

  // "Dodaj kod z aplikacji" asks for the secret first (W-04 before the dialog); the dialog opens with it.
  const reauthTotp = useReauthCall('second_step_change', t('stepUp.title.addTotp'), account.email);
  const startTotp = useMutation({
    gcTime: 0,
    mutationFn: () => reauthTotp.run(() => unwrap(startTotpEnrolment({ client }))),
    onSuccess: (setup) => {
      setOpen({ kind: 'addTotp', setup });
    },
    onError: (error) => {
      if (error instanceof ReauthenticationCancelled) return;
      setFailure(describeAccountFailure(error));
    },
  });

  const remaining = recoveryCodes?.remaining ?? 0;
  const lowCodes = recoveryCodes !== null && remaining <= 3;
  const codesLeft = (count: number): string => {
    switch (pluralOf(count)) {
      case 'one':
        return t('account.codes.leftOne', { count });
      case 'few':
        return t('account.codes.leftFew', { count });
      case 'many':
        return t('account.codes.leftMany', { count });
    }
  };
  const lowText = (count: number): string => {
    if (count === 0) return t('account.codes.lowNone');
    return pluralOf(count) === 'one' ? t('account.codes.lowOne', { count }) : t('account.codes.lowFew', { count });
  };
  const ruleText = role === 'administrator' ? t('account.rules.administratorKey') : t('account.rules.lastMethod');
  const removeButton = (target: RemoveTarget, off: boolean, label: string, hintId: string) => (
    <Button
      variant="tertiary"
      aria-label={label}
      aria-describedby={off ? hintId : undefined}
      disabled={!online || off}
      onClick={() => {
        setFailure(null);
        setOpen({ kind: 'remove', target });
      }}
    >
      {t('account.remove.button')}
    </Button>
  );
  const passkeyRow = (passkey: Passkey) => (
    <ListItem key={passkey.id}>
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <p className="flex items-center gap-inline-sm">
          <KeyRound aria-hidden="true" className="size-icon-md shrink-0 text-icon-secondary" />
          <span>
            {/* The name is plain text made by the person: rendered as text, never as markup (SR-INPUT-05). */}
            {`${passkey.name} · ${t('account.passkeys.added', { date: formatDate(passkey.createdAt) })}`}
          </span>
        </p>
        {removeButton({ kind: 'passkey', passkey }, rule.passkey, t('account.remove.passkeyLabel', { name: passkey.name }), `${id}-rule`)}
      </div>
    </ListItem>
  );

  return (
    <Card labelledBy={`${id}-title`}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="text-heading-3 focus-visible:focus-ring">
        {t('account.secondStep.title')}
      </h2>
      <p className="text-body text-text-secondary">{t('account.secondStep.intro')}</p>
      {failure === null ? null : <AccountFailureAlert failure={failure} notFound={t('account.passkeys.notFound')} />}

      <section aria-labelledby={`${id}-keys`} className="flex flex-col gap-stack-sm">
        <h3 id={`${id}-keys`} className="text-label">
          {t('account.passkeys.title')}
        </h3>
        <List labelledBy={`${id}-keys`}>{passkeys.map(passkeyRow)}</List>
        {rule.passkey && passkeys.length > 0 ? (
          <p id={`${id}-rule`} className="text-body-sm text-text-secondary">
            {ruleText}
          </p>
        ) : null}
        <div>
          <Button
            variant="secondary"
            icon={Plus}
            disabled={!online}
            onClick={() => {
              setFailure(null);
              setOpen({ kind: 'addPasskey' });
            }}
          >
            {t('account.passkeys.add')}
          </Button>
        </div>
        {role === 'administrator' && passkeys.length === 1 ? (
          <InlineAlert tone="info">{t('account.passkeys.secondKey')}</InlineAlert>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-totp`} className="flex flex-col gap-stack-sm">
        <h3 id={`${id}-totp`} className="text-label">
          {t('account.totp.title')}
        </h3>
        {totp === null ? (
          <>
            <p className="text-body text-text-secondary">{t('account.totp.none')}</p>
            {/* An Administrator's code of the app is a thing of the phone application (the API refuses it in the panel). */}
            {role === 'administrator' ? null : (
              <div>
                <Button
                  variant="secondary"
                  icon={Smartphone}
                  loading={startTotp.isPending}
                  disabled={!online}
                  onClick={() => {
                    setFailure(null);
                    startTotp.mutate();
                  }}
                >
                  {t('account.totp.add')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-inline-md">
              <p className="flex items-center gap-inline-sm">
                <Smartphone aria-hidden="true" className="size-icon-md shrink-0 text-icon-secondary" />
                <span>{t('account.totp.added', { date: formatDate(totp.addedAt) })}</span>
              </p>
              {removeButton({ kind: 'totp' }, rule.totp, t('account.remove.totpLabel'), `${id}-rule-totp`)}
            </div>
            {rule.totp ? (
              <p id={`${id}-rule-totp`} className="text-body-sm text-text-secondary">
                {ruleText}
              </p>
            ) : null}
            {role === 'administrator' ? <p className="text-body-sm text-text-secondary">{t('account.totp.administratorOnly')}</p> : null}
          </>
        )}
      </section>

      <section aria-labelledby={`${id}-codes`} className="flex flex-col gap-stack-sm">
        <h3 id={`${id}-codes`} className="text-label">
          {t('account.codes.title')}
        </h3>
        {recoveryCodes === null ? (
          <>
            <Banner icon={TriangleAlert}>{t('account.codes.none')}</Banner>
            <div>
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => {
                  setFailure(null);
                  setOpen({ kind: 'codes' });
                }}
              >
                {t('account.codes.generateFirst')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-body">
              {`${codesLeft(remaining)} · ${t('account.codes.generated', { date: formatDate(recoveryCodes.generatedAt) })}`}
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => {
                  setFailure(null);
                  setOpen({ kind: 'codes' });
                }}
              >
                {t('account.codes.regenerate')}
              </Button>
            </div>
            {lowCodes ? <Banner icon={TriangleAlert}>{lowText(remaining)}</Banner> : null}
          </>
        )}
      </section>
      {online ? null : (
        <Banner icon={Info} tone="info">
          {t('account.offlineHint')}
        </Banner>
      )}

      {open?.kind === 'addPasskey' ? (
        <AddPasskeyDialog
          email={account.email}
          online={online}
          onClose={close}
          onAdded={() => {
            done(t('account.passkeys.addedToast'));
          }}
        />
      ) : null}
      {open?.kind === 'remove' ? (
        <RemoveMethodDialog
          target={open.target}
          role={role}
          email={account.email}
          online={online}
          onClose={close}
          onRemoved={() => {
            done(open.target.kind === 'passkey' ? t('account.remove.passkeyDone') : t('account.remove.totpDone'));
          }}
          onGone={() => {
            done(open.target.kind === 'passkey' ? t('account.passkeys.notFound') : t('account.totp.notFound'));
          }}
        />
      ) : null}
      {open?.kind === 'addTotp' ? (
        <AddTotpDialog
          setup={open.setup}
          online={online}
          onClose={close}
          onAdded={() => {
            done(t('account.totp.addedToast'));
          }}
        />
      ) : null}
      {open?.kind === 'codes' ? (
        <NewRecoveryCodes
          email={account.email}
          online={online}
          onClose={close}
          onDone={() => {
            done(t('account.codes.doneToast'));
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * "Dodaj kod z aplikacji" (EVM-028 AC3): the same QR code, the key to type in and the field of the code as step 2 of W-03 (the secret was
 * made after the full re-authentication and lives in this dialog only). The method works only after a correct code; the session is not
 * rotated (the answer carries the current CSRF token, which the panel keeps).
 */
function AddTotpDialog({
  setup,
  online,
  onClose,
  onAdded,
}: {
  readonly setup: TotpSetup;
  readonly online: boolean;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog
      open
      title={t('account.totp.addTitle')}
      closeLabel={t('account.close')}
      onDismiss={onClose}
      actions={
        <Button variant="tertiary" onClick={onClose}>
          {t('account.cancel')}
        </Button>
      }
    >
      <TotpEnrolment
        online={online}
        headingRef={heading}
        initialSetup={setup}
        heading={false}
        onConfirmed={(csrfToken) => {
          setCsrfToken(csrfToken);
          onAdded();
          return Promise.resolve();
        }}
      />
    </Dialog>
  );
}
