import type { Document as OrderDocument, UpdateDocumentRequest } from '@evia/contracts';
import { Button, Dialog, InlineAlert, Select, TextArea, TextField } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { documentText } from './document-labels.ts';
import { isStageRejection, NO_STAGE, stageSelectOptions, useStageChoices } from './stage-choice.ts';
import { editDocumentFailure, useEditDocument } from './use-documents.ts';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * "Edytuj…" from the menu `⋮` of a document (W-09; EVM-048 AC3, AC8): the title, the description (text only, with the reminder about PESEL) and the stage
 * of the order. Sent with the version of the document (`If-Match`): on `412` the data on the server stay and the dialog stays open with what was
 * typed; a stage that is gone gives a message and a fresh list of stages; offline the save is off. Only the fields that changed are sent.
 */
export function DocumentEditDialog({
  workOrderId,
  document,
  onClose,
}: {
  readonly workOrderId: string;
  readonly document: OrderDocument | null;
  readonly onClose: () => void;
}) {
  const online = useOnline();
  const edit = useEditDocument(workOrderId);
  const stages = useStageChoices(workOrderId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState(NO_STAGE);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const documentId = document?.id ?? null;

  useEffect(() => {
    if (document === null) return;
    setTitle(document.title);
    setDescription(document.description ?? '');
    setStage(document.procedureStageId ?? NO_STAGE);
    setTitleError(null);
    setFailure(null);
    // the form starts again for every document (a refresh of the list after `412` must not wipe what was typed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const { refresh } = stages;
  useEffect(() => {
    if (documentId !== null) void refresh();
  }, [documentId, refresh]);

  const known = stages.choices.some((choice) => choice.id === stage);

  const submit = () => {
    if (document === null) return;
    setFailure(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setTitleError(documentText.titleMissing);
      return;
    }
    setTitleError(null);
    const text = description.trim();
    const wanted = text === '' ? null : text;
    const wantedStage = stage === NO_STAGE ? null : stage;
    const patch: UpdateDocumentRequest = {
      ...(trimmedTitle === document.title ? {} : { title: trimmedTitle }),
      ...(wanted === document.description ? {} : { description: wanted }),
      ...(wantedStage === document.procedureStageId ? {} : { procedureStageId: wantedStage }),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    edit.mutate(
      { document, patch },
      {
        onSuccess: onClose,
        onError: (error) => {
          setFailure(editDocumentFailure(error));
          if (isStageRejection(error)) {
            setStage(NO_STAGE);
            void refresh();
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={document !== null}
      size="sm"
      title={documentText.editTitle}
      closeLabel={documentText.closeDialog}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {documentText.cancel}
          </Button>
          <Button loading={edit.isPending} disabled={!online} onClick={submit}>
            {documentText.editSave}
          </Button>
        </>
      }
    >
      {online ? null : <InlineAlert tone="info">{documentText.offlineNote}</InlineAlert>}
      <TextField
        label={documentText.titleField}
        value={title}
        {...(titleError === null ? {} : { error: titleError })}
        onChange={(event) => {
          setTitle(event.target.value.slice(0, TITLE_MAX));
        }}
      />
      <Select
        label={documentText.stage}
        value={known ? stage : NO_STAGE}
        options={stageSelectOptions(stages.choices, documentText.noStage)}
        onChange={setStage}
      />
      {stages.failed ? <InlineAlert tone="error">{documentText.stagesFailed}</InlineAlert> : null}
      <TextArea
        label={documentText.descriptionField}
        value={description}
        rows={3}
        hint={documentText.descriptionHint}
        onChange={(event) => {
          setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
        }}
      />
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
    </Dialog>
  );
}
