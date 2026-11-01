import type { DocumentKind } from '@evia/contracts';
import { Button, Dialog, FileText, InlineAlert, RadioGroup, Select, TextArea, TextField, Uploader } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { checkDocumentFile, DOCUMENT_ACCEPT } from './document-files.ts';
import { confidentialityLabel, documentText, effectiveClass, higherClasses, OTHER_KIND } from './document-labels.ts';
import type { DocumentUploadEngine } from './document-upload-engine.ts';
import { formatBytes } from './media-labels.ts';
import { NO_STAGE, stageSelectOptions, useStageChoices } from './stage-choice.ts';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
// control characters are refused by the server; the panel strips them from what is pasted
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

interface Errors {
  file?: string;
  kind?: string;
  identity?: string;
  title?: string;
}

/**
 * The dialog "Dodaj dokument" (W-09; EVM-047 AC1, AC2, AC3, AC4, AC6): the file (PDF, DOCX, XLSX, JPG, PNG up to 100 MB - refused here before anything is
 * sent, the server and the scan decide again), the kind with the class it gives, the question about PESEL for "Inny dokument" (an answer is required),
 * the title, "Podnieś klasę" (only the classes above the one of the kind) and the description. The send runs in the engine of the tab; the dialog closes.
 */
export function DocumentUploadDialog({
  open,
  workOrderId,
  kinds,
  kindsFailed,
  engine,
  onClose,
}: {
  readonly open: boolean;
  readonly workOrderId: string;
  readonly kinds: readonly DocumentKind[];
  readonly kindsFailed: boolean;
  readonly engine: DocumentUploadEngine;
  readonly onClose: () => void;
}) {
  const [file, setFile] = useState<{ readonly file: File; readonly contentType: string } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [kindCode, setKindCode] = useState('');
  const [identity, setIdentity] = useState<'' | 'yes' | 'no'>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [raise, setRaise] = useState('');
  const [stage, setStage] = useState(NO_STAGE);
  const stages = useStageChoices(workOrderId);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setRefused(null);
    setKindCode('');
    setIdentity('');
    setTitle('');
    setDescription('');
    setRaise('');
    setStage(NO_STAGE);
    setErrors({});
  }, [open]);

  const kind = kinds.find((entry) => entry.code === kindCode);
  const isOther = kindCode === OTHER_KIND;
  const effective = kind === undefined ? 'standard' : effectiveClass(kind.confidentiality, isOther && identity === 'yes');
  const raiseOptions = higherClasses(effective);

  const pick = (picked: readonly File[]) => {
    const first = picked[0];
    if (first === undefined) return;
    const verdict = checkDocumentFile(first);
    if (verdict.ok) {
      setFile({ file: first, contentType: verdict.contentType });
      setRefused(null);
      setErrors((current) => ({ ...current, file: undefined }));
      return;
    }
    setFile(null);
    setRefused(
      verdict.reason === 'size'
        ? documentText.tooLarge(first.name)
        : verdict.reason === 'empty'
          ? documentText.emptyFile(first.name)
          : documentText.unsupported(first.name),
    );
  };

  const submit = () => {
    const next: Errors = {};
    if (file === null) next.file = documentText.fileMissing;
    if (kind === undefined) next.kind = documentText.kindMissing;
    if (isOther && identity === '') next.identity = documentText.identityMissing;
    if (title.trim() === '') next.title = documentText.titleMissing;
    setErrors(next);
    if (file === null || kind === undefined || Object.keys(next).length > 0) return;
    const override = raiseOptions.find((value) => value === raise);
    const trimmedDescription = description.replace(CONTROL, ' ').trim();
    onClose();
    void engine.add({
      file: file.file,
      contentType: file.contentType,
      kindCode: kind.code,
      title: title.replace(CONTROL, ' ').trim(),
      description: trimmedDescription,
      containsIdentityData: isOther ? identity === 'yes' : null,
      confidentialityOverride: override ?? null,
      procedureStageId: stage === NO_STAGE || !stages.choices.some((choice) => choice.id === stage) ? null : stage,
    });
  };

  return (
    <Dialog
      open={open}
      title={documentText.dialogTitle}
      closeLabel={documentText.closeDialog}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {documentText.cancel}
          </Button>
          <Button onClick={submit}>{documentText.submit}</Button>
        </>
      }
    >
      <Uploader
        variant="button"
        buttonLabel={documentText.chooseFile}
        buttonIcon={FileText}
        inputLabel={documentText.fileInput}
        accept={DOCUMENT_ACCEPT}
        hint={documentText.limits}
        onFiles={pick}
      />
      {file === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-inline-md">
          <span className="min-w-0 break-words text-body">{`${file.file.name} · ${formatBytes(file.file.size)}`}</span>
          <Button
            variant="tertiary"
            size="lg"
            onClick={() => {
              setFile(null);
            }}
          >
            {documentText.removeFile}
          </Button>
        </div>
      )}
      {refused === null ? null : <InlineAlert tone="error">{refused}</InlineAlert>}
      {errors.file === undefined ? null : <InlineAlert tone="error">{errors.file}</InlineAlert>}
      {kindsFailed ? <InlineAlert tone="error">{documentText.kindsFailed}</InlineAlert> : null}
      <Select
        label={documentText.kind}
        value={kindCode}
        options={[{ value: '', label: documentText.kindPlaceholder }, ...kinds.map((entry) => ({ value: entry.code, label: entry.name }))]}
        {...(errors.kind === undefined ? {} : { error: errors.kind })}
        onChange={(value) => {
          setKindCode(value);
          setIdentity('');
          setRaise('');
        }}
      />
      {isOther ? (
        <RadioGroup
          legend={documentText.identityQuestion}
          options={[
            { value: 'no', label: documentText.identityNo },
            { value: 'yes', label: documentText.identityYes },
          ]}
          value={identity}
          {...(errors.identity === undefined ? {} : { error: errors.identity })}
          onChange={(value) => {
            setIdentity(value as 'yes' | 'no');
            setRaise('');
          }}
        />
      ) : null}
      <TextField
        label={documentText.titleField}
        value={title}
        {...(errors.title === undefined ? {} : { error: errors.title })}
        onChange={(event) => {
          setTitle(event.target.value.slice(0, TITLE_MAX));
        }}
      />
      {kind === undefined ? null : (
        <p className="text-body text-text-secondary">{documentText.classFromKind(confidentialityLabel(effective))}</p>
      )}
      {kind !== undefined && raiseOptions.length > 0 ? (
        <Select
          label={documentText.raise}
          value={raise}
          hint={documentText.raiseHint}
          options={[
            { value: '', label: documentText.raiseNone },
            ...raiseOptions.map((value) => ({ value, label: confidentialityLabel(value) })),
          ]}
          onChange={setRaise}
        />
      ) : null}
      <Select
        label={documentText.stage}
        value={stage}
        options={stageSelectOptions(stages.choices, documentText.noStage)}
        onChange={setStage}
      />
      {stages.failed ? <InlineAlert tone="error">{documentText.stagesFailed}</InlineAlert> : null}
      <TextArea
        label={documentText.descriptionField}
        value={description}
        rows={2}
        hint={documentText.descriptionHint}
        onChange={(event) => {
          setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
        }}
      />
    </Dialog>
  );
}
