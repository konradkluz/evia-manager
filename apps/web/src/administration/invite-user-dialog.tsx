import { inviteUser, type User, type UserRole } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, RadioGroup, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useOnline } from '../shell/use-online.ts';
import { ROLES } from './labels.ts';
import {
  buildInviteBody,
  checkInvite,
  EMPTY_INVITE,
  fieldErrorsOf,
  firstInvalid,
  inviteErrorText,
  type InviteErrors,
  type InviteField,
  type InviteForm,
} from './user-form.ts';
import { describeUserFailure, type UserFailure } from './user-failure.ts';
import { UserFailureAlert } from './user-failure-alert.tsx';
import { useGuardedCall } from './use-guarded-call.ts';

export interface InviteUserDialogProps {
  readonly open: boolean;
  /** Esc, `x`, "Anuluj" and a sent invitation; what was typed stays in the memory of the tab unless `discard` is set. */
  readonly onClose: (discard: boolean) => void;
  /** The invitation was accepted by the server (the account exists, the e-mail is in the outbox). */
  readonly onInvited: (user: User) => void;
  /** The account of the loaded page of the list with this identifier (for the sentence of `409 email_conflict`). */
  readonly find: (id: string) => User | undefined;
  /** "Pokaż konto" of the alert `409`: the dialog closes and the row of the account is shown. */
  readonly onShowAccount: (id: string) => void;
}

/**
 * Dialog "Zaproś użytkownika" (EVM-024 AC1, AC2, AC5, AC7; W-16 dialog 1): e-mail, display name and role (Edytor by default) with a
 * summary of the effect. The first save names the account (`id`, UUIDv7) and the request (`Idempotency-Key`); a retry of the same
 * content after a network error or W-04 sends the same pair, so no second account appears; changed content is a new request.
 * `403 step_up_required` opens W-04 ("Potwierdź tożsamość, aby zaprosić użytkownika") — the dialog steps aside and keeps its data —
 * and the same request is sent again once. The Administrator never sees the link or the token of the invitation. What is typed
 * lives in this component only: not in the address, the storage of the browser or a log.
 */
export function InviteUserDialog({ open, onClose, onInvited, find, onShowAccount }: InviteUserDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const attempt = useAttempt();
  const guarded = useGuardedCall(t('stepUp.title.inviteUser'));
  const [form, setForm] = useState<InviteForm>(EMPTY_INVITE);
  const [errors, setErrors] = useState<InviteErrors>({});
  const [failure, setFailure] = useState<UserFailure | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const fields = useRef<Partial<Record<InviteField, HTMLInputElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildInviteBody>; readonly key: string }) =>
      guarded.run(() => unwrap(inviteUser({ client, body: request.body, headers: { 'Idempotency-Key': request.key } }))),
  });

  // After a failed send the focus goes to the first invalid field, or to the message when no field is to blame (§ 4.1); only a new
  // attempt asks for it — fixing one field must not pull the focus to another.
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalid(errors);
    if (invalid !== undefined) fields.current[invalid]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const reset = () => {
    setForm(EMPTY_INVITE);
    setErrors({});
    setFailure(null);
    attempt.forget();
    mutation.reset();
  };

  const clearError = (field: InviteField) => {
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };

  const submit = () => {
    const problems = checkInvite(form);
    if (problems.length > 0) {
      setErrors(Object.fromEntries(problems.map(({ field, code }) => [field, inviteErrorText(t, field, code)])));
      setFailure(null);
      setFocusRequest((current) => current + 1);
      return;
    }
    const { id, key } = attempt.next(JSON.stringify(buildInviteBody(form, '')));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: buildInviteBody(form, id), key },
      {
        onSuccess: (user) => {
          reset();
          onInvited(user);
        },
        onError: (error) => {
          const mapped = error instanceof ApiError && error.status === 400 ? fieldErrorsOf(t, error) : {};
          if (refusesAttempt(error)) attempt.forget();
          setErrors(mapped);
          setFailure(describeUserFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const text = (field: 'email' | 'displayName', label: string, extra: { type?: 'email'; hint?: string } = {}) => (
    <TextField
      label={label}
      value={form[field]}
      type={extra.type ?? 'text'}
      autoComplete="off"
      {...(extra.hint === undefined ? {} : { hint: extra.hint })}
      {...(errors[field] === undefined ? {} : { error: errors[field] })}
      inputRef={(element) => {
        fields.current[field] = element;
      }}
      onChange={(event) => {
        setForm((current) => ({ ...current, [field]: event.target.value }));
        clearError(field);
      }}
    />
  );

  const roleText = (role: UserRole): string => {
    switch (role) {
      case 'administrator':
        return t('users.dialog.roleAdministrator');
      case 'read_only':
        return t('users.dialog.roleReadOnly');
      case 'editor':
        return t('users.dialog.roleEditor');
    }
  };

  return (
    <Dialog
      open={open && !guarded.stepping}
      title={t('users.dialog.title')}
      closeLabel={t('users.dialog.close')}
      onDismiss={() => {
        onClose(false);
      }}
      actions={
        <>
          <Button
            variant="tertiary"
            onClick={() => {
              reset();
              onClose(true);
            }}
          >
            {t('users.dialog.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!online}>
            {t('users.dialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-stack-md"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {online ? null : <Banner icon={WifiOff}>{t('users.dialog.offline')}</Banner>}
        {failure === null ? null : (
          <UserFailureAlert
            failure={failure}
            find={find}
            alertRef={alert}
            onShowAccount={onShowAccount}
            onRefresh={() => {
              onClose(false);
            }}
          />
        )}
        {text('email', t('users.dialog.email'), { type: 'email' })}
        {text('displayName', t('users.dialog.displayName'), { hint: t('users.dialog.displayNameHint') })}
        <RadioGroup
          legend={t('users.dialog.role')}
          value={form.role}
          onChange={(role) => {
            setForm((current) => ({ ...current, role: ROLES.find((known) => known === role) ?? current.role }));
            clearError('role');
          }}
          options={ROLES.map((role) => ({ value: role, label: roleText(role) }))}
          {...(errors.role === undefined ? {} : { error: errors.role })}
        />
        <p className="text-body text-text-secondary">{t('users.dialog.info')}</p>
        {form.role === 'administrator' ? <InlineAlert tone="info">{t('users.dialog.administratorAlert')}</InlineAlert> : null}
      </form>
    </Dialog>
  );
}
