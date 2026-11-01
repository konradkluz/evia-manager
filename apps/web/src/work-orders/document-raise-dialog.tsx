import type { Document as OrderDocument } from '@evia/contracts';
import { Button, Dialog, InlineAlert, Select } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { confidentialityLabel, documentText, higherClasses } from './document-labels.ts';
import { raiseFailure, useRaiseClass } from './use-documents.ts';

/**
 * "Podnieś klasę" from the menu `⋮` of a document (W-09; EVM-047 AC4): the control offers only the classes above the effective one and the
 * change is sent with the version of the document (`If-Match`); the server refuses a lower or equal class (`400`) and writes the audit event.
 */
export function DocumentRaiseDialog({
  workOrderId,
  document,
  onClose,
}: {
  readonly workOrderId: string;
  readonly document: OrderDocument | null;
  readonly onClose: () => void;
}) {
  const raise = useRaiseClass(workOrderId);
  const [target, setTarget] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const options = document === null ? [] : higherClasses(document.confidentiality);

  useEffect(() => {
    setTarget(options[0] ?? '');
    setFailure(null);
    // the choice starts again for every document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id]);

  const submit = () => {
    const chosen = options.find((value) => value === target);
    if (document === null || chosen === undefined) return;
    setFailure(null);
    raise.mutate(
      { document, confidentialityOverride: chosen },
      {
        onSuccess: onClose,
        onError: (error) => {
          setFailure(raiseFailure(error));
        },
      },
    );
  };

  return (
    <Dialog
      open={document !== null}
      size="sm"
      title={documentText.raiseTitle}
      closeLabel={documentText.closeDialog}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {documentText.cancel}
          </Button>
          <Button loading={raise.isPending} onClick={submit}>
            {documentText.raiseConfirm}
          </Button>
        </>
      }
    >
      <p className="text-body">{documentText.raiseBody}</p>
      <Select
        label={documentText.raiseTarget}
        value={target}
        options={options.map((value) => ({ value, label: confidentialityLabel(value) }))}
        onChange={setTarget}
      />
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
    </Dialog>
  );
}
