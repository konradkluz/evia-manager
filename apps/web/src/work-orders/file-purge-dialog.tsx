import { AlertDialog, Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { eraseText } from './erase-labels.ts';
import {
  describeFailure,
  failureText,
  purgeSubject,
  refreshesList,
  useRefreshFiles,
  type EraseFailure,
  type EraseSubject,
} from './file-erase.ts';

/**
 * "Usunąć plik trwale?" (EVM-051 AC2, AC3, AC7; W-09, § 4.17): an irreversible operation, so the focus starts on "Anuluj". After
 * "Usuń plik trwale" W-04 opens when the server asks for it (`403 step_up_required`) and the same call is sent again; cancelling it
 * says "Nie wykonano operacji." and changes nothing. A refused register is `503` and the file stays. The dialog and the toast name no
 * file, title or description. The text does not promise that backups lose the file at once (RR-14).
 */
export function FilePurgeDialog({
  workOrderId,
  subject,
  onClose,
}: {
  readonly workOrderId: string;
  readonly subject: EraseSubject;
  readonly onClose: () => void;
}) {
  const client = useApi();
  const online = useOnline();
  const showToast = useToast();
  const refresh = useRefreshFiles(workOrderId);
  const guarded = useGuardedCall(eraseText.stepUpTitle);
  const [failure, setFailure] = useState<EraseFailure | null>(null);

  // The effects live in the options of the mutation: while the call runs the dialog cannot be dismissed, so it never unmounts mid-flight.
  const mutation = useMutation({
    mutationFn: () => guarded.run(() => purgeSubject(client, workOrderId, subject)),
    onSuccess: () => {
      refresh();
      showToast(eraseText.purged);
      onClose();
    },
    onError: (error) => {
      const failed = describeFailure(error);
      if (refreshesList(failed)) refresh();
      setFailure(failed);
    },
  });
  const running = mutation.isPending;
  const dismiss = () => {
    if (!running) onClose();
  };

  return (
    <AlertDialog
      open={!guarded.stepping}
      title={eraseText.purgeTitle}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus disabled={running} onClick={dismiss}>
            {eraseText.cancel}
          </Button>
          <Button
            variant="danger"
            loading={running}
            disabled={!online}
            {...(online ? {} : { title: eraseText.offline })}
            onClick={() => {
              setFailure(null);
              mutation.mutate();
            }}
          >
            {eraseText.purgeConfirm}
          </Button>
        </>
      }
    >
      <p>{subject.kind === 'media' ? eraseText.purgeBodyMedia : eraseText.purgeBodyDocument}</p>
      <p className="text-text-secondary">{eraseText.purgeBackups}</p>
      {online ? null : <Banner icon={WifiOff}>{eraseText.offline}</Banner>}
      {failure === null ? null : <InlineAlert tone="error">{failureText(failure)}</InlineAlert>}
    </AlertDialog>
  );
}
