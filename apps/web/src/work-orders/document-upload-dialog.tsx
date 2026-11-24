import type { DocumentAnchor, DocumentKind } from '@evia/contracts';
import { Button, Dialog, FileText, InlineAlert, RadioGroup, Select, TextArea, TextField, Uploader } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { checkDocumentFile, DOCUMENT_ACCEPT } from './document-files.ts';
import { confidentialityLabel, documentText, effectiveClass, higherClasses, OTHER_KIND } from './document-labels.ts';
import type { DocumentUploadEngine, NewDocument } from './document-upload-engine.ts';
import { formatBytes } from './media-labels.ts';
import { NO_STAGE, stageSelectOptions, useStageChoices } from './stage-choice.ts';

/** The only kind a site survey without a customer accepts (ADR-0025 pt 2); fixed here, never taken from a field. */
export const SURVEY_KIND_CODE = 'quote';
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
// control characters are refused by the server; the panel strips them from what is pasted
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

interface Errors {
  file?: string;
  kind?: string;
  identity?: string;
  anchor?: string;
  title?: string;
}

/**
 * The dialog "Dodaj dokument" (W-09; EVM-047 AC1, AC2, AC3, AC4, AC6): the file (PDF, DOCX, XLSX, JPG, PNG up to 100 MB - refused here before anything is
 * sent, the server and the scan decide again), the kind with the class it gives, the question about PESEL for "Inny dokument" (an answer is required),
 * the title, "Podnieś klasę" (only the classes above the one of the kind) and the description. The send runs in the engine of the tab; the dialog closes.
 * EVM-148: for a site survey without a customer (`survey`) the form is an offer only: "Przypisz do" and "Rodzaj" are read-only text, the kind is the
 * fixed `quote`, no class, stage or anchor is chosen (so none can be sent) and a warning about personal data stands above the title. `initial` fills
 * the form again after "Dodaj ponownie" (the same file and fields, held in the memory of the tab only).
 */
export function DocumentUploadDialog({
  open,
  workOrderId,
  hasSite,
  hasCustomer,
  survey,
  initial,
  kinds,
  kindsFailed,
  engine,
  onClose,
}: {
  readonly open: boolean;
  readonly workOrderId: string;
  /** The order has a location / a customer to anchor the document to (EVM-050); an option that cannot work is not offered. */
  readonly hasSite: boolean;
  readonly hasCustomer: boolean;
  /** EVM-148: a site survey without a customer - the form offers the offer only (decided by the data of the order, never by a guess). */
  readonly survey: boolean;
  /** The file and the fields to start with ("Dodaj ponownie"); `null` = an empty form. */
  readonly initial: NewDocument | null;
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
  const [anchor, setAnchor] = useState<DocumentAnchor>('work_order');
  const stages = useStageChoices(workOrderId);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setFile(initial === null ? null : { file: initial.file, contentType: initial.contentType });
    setRefused(null);
    setKindCode(initial?.kindCode ?? '');
    setIdentity('');
    setTitle(initial?.title ?? '');
    setDescription(initial?.description ?? '');
    setRaise('');
    setStage(NO_STAGE);
    setAnchor('work_order');
    setErrors({});
  }, [open, initial]);

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
    if (!survey && kind === undefined) next.kind = documentText.kindMissing;
    if (isOther && identity === '') next.identity = documentText.identityMissing;
    if (title.trim() === '') next.title = documentText.titleMissing;
    // identity data never sits on a location (AB-19, SR-AUTHZ-08): the server refuses it too (`400 identity_data_not_on_site`)
    if (anchor === 'site' && kind !== undefined && (effective === 'identity_data' || raise === 'identity_data'))
      next.anchor = documentText.anchorIdentityOnSite;
    setErrors(next);
    if (file === null || Object.keys(next).length > 0) return;
    const trimmedTitle = title.replace(CONTROL, ' ').trim();
    const trimmedText = description.replace(CONTROL, ' ').trim();
    if (survey) {
      // K2: the offer of a survey is the kind `quote` for the order and nothing else - no class, no stage, no identity flag, no other anchor
      onClose();
      void engine.add({
        file: file.file,
        contentType: file.contentType,
        kindCode: SURVEY_KIND_CODE,
        title: trimmedTitle,
        description: trimmedText,
        containsIdentityData: null,
        confidentialityOverride: null,
        procedureStageId: null,
        anchor: 'work_order',
      });
      return;
    }
    if (kind === undefined) return;
    const override = raiseOptions.find((value) => value === raise);
    onClose();
    void engine.add({
      file: file.file,
      contentType: file.contentType,
      kindCode: kind.code,
      title: trimmedTitle,
      description: trimmedText,
      containsIdentityData: isOther ? identity === 'yes' : null,
      confidentialityOverride: override ?? null,
      procedureStageId:
        anchor !== 'work_order' || stage === NO_STAGE || !stages.choices.some((choice) => choice.id === stage) ? null : stage,
      anchor,
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
      {kindsFailed && !survey ? <InlineAlert tone="error">{documentText.kindsFailed}</InlineAlert> : null}
      {survey ? (
        <>
          <TextField label={documentText.anchorLegend} value={documentText.surveyOffer.anchorValue} readOnly />
          <TextField label={documentText.kindShort} value={documentText.surveyOffer.kindValue} readOnly />
          <InlineAlert tone="info" title={documentText.surveyOffer.warningTitle}>
            {documentText.surveyOffer.warning}
          </InlineAlert>
        </>
      ) : null}
      {survey ? null : (
        <>
          <Select
            label={documentText.kind}
            value={kindCode}
            options={[
              { value: '', label: documentText.kindPlaceholder },
              ...kinds.map((entry) => ({ value: entry.code, label: entry.name })),
            ]}
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
        </>
      )}
      <TextField
        label={documentText.titleField}
        value={title}
        {...(errors.title === undefined ? {} : { error: errors.title })}
        onChange={(event) => {
          setTitle(event.target.value.slice(0, TITLE_MAX));
        }}
      />
      {survey ? null : (
        <>
          <RadioGroup
            legend={documentText.anchorLegend}
            options={[
              { value: 'work_order', label: documentText.anchorOrder },
              ...(hasSite ? [{ value: 'site', label: documentText.anchorSite }] : []),
              ...(hasCustomer ? [{ value: 'customer', label: documentText.anchorCustomer }] : []),
            ]}
            value={anchor}
            {...(errors.anchor === undefined ? {} : { error: errors.anchor })}
            onChange={(value) => {
              setAnchor(value as DocumentAnchor);
              setErrors((current) => ({ ...current, anchor: undefined }));
            }}
          />
          {anchor === 'site' ? <InlineAlert tone="info">{documentText.anchorSiteNote}</InlineAlert> : null}
          {anchor === 'customer' ? <p className="text-body text-text-secondary">{documentText.anchorCustomerNote}</p> : null}
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
          {anchor === 'work_order' ? (
            <Select
              label={documentText.stage}
              value={stage}
              options={stageSelectOptions(stages.choices, documentText.noStage)}
              onChange={setStage}
            />
          ) : null}
          {anchor === 'work_order' && stages.failed ? <InlineAlert tone="error">{documentText.stagesFailed}</InlineAlert> : null}
        </>
      )}
      <TextArea
        label={documentText.descriptionField}
        value={description}
        rows={2}
        hint={survey ? documentText.surveyOffer.descriptionHint : documentText.descriptionHint}
        onChange={(event) => {
          setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
        }}
      />
    </Dialog>
  );
}
