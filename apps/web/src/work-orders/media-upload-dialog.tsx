import type { MediaCategory } from '@evia/contracts';
import { Banner, Button, Dialog, Images, InlineAlert, Select, TextArea, TriangleAlert, Uploader } from '@evia/ui-web';
import { useEffect, useRef, useState } from 'react';
import { checkFile, isVideoType, LARGE_VIDEO_BYTES, MAX_BATCH, MAX_VIDEO_SECONDS, readVideoDuration } from './media-files.ts';
import { categoryLabel, filesCount, formatBytes, mediaCategoryLabels, mediaText, photosCount } from './media-labels.ts';
import { NO_STAGE, stageSelectOptions, useStageChoices } from './stage-choice.ts';
import type { MediaUpload } from './use-media.ts';

const CATEGORIES = Object.keys(mediaCategoryLabels) as MediaCategory[];
/** The category of the mockup W-09: the usual photo of the work in progress. */
const DEFAULT_CATEGORY: MediaCategory = 'in_progress';
const DESCRIPTION_MAX = 1000;
/** Containers that look like a film but are not on the list of the API: told as a film format, not as a photo format. */
const OTHER_VIDEO = /\.(avi|mkv|webm|wmv|flv|3gp|m4v|mpg|mpeg)$/i;

interface Chosen {
  /** Stable for the life of the choice: the key of the row does not move when another row is removed. */
  readonly id: number;
  readonly file: File;
  readonly contentType: string;
}

interface Selection {
  readonly chosen: readonly Chosen[];
  readonly skipped: readonly string[];
  readonly overflow: boolean;
}

const EMPTY: Selection = { chosen: [], skipped: [], overflow: false };

/**
 * The dialog "Dodaj zdjęcia lub filmy" (W-09, W-09 w przeglądarce telefonu 2–4; EVM-044 AC1, AC2, AC4, EVM-046 AC1, AC8): the system picker
 * of files ("Wybierz z galerii"), the chosen files with their sizes and "Usuń z wyboru", the files left out with the reason (SVG, HTML,
 * archives, photos over 50 MB, films over 4 GB or 30 min — the server checks the content again), the category and the description,
 * and "Wyślij N plików". A film over 100 MB gets one more step in the same dialog: the warning about the data plan with "Wyślij teraz" and
 * "Anuluj". A file that fits an unfinished session of the person resumes it instead of making a new medium (AC4).
 * The chosen files live in the state of the dialog only (memory of the tab; nothing in the storage of the browser — SR-WEB-05).
 */
export function MediaUploadDialog({ media, workOrderId }: { readonly media: MediaUpload; readonly workOrderId: string }) {
  const { dialog, closeDialog, engine, sessions } = media;
  const stages = useStageChoices(workOrderId);
  const [stage, setStage] = useState(NO_STAGE);
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [warning, setWarning] = useState(false);
  const [category, setCategory] = useState<MediaCategory>(DEFAULT_CATEGORY);
  const [description, setDescription] = useState('');
  const lastId = useRef(0);
  // a choice that is still being read (the duration of a film) when the dialog is closed and opened again must not land in the new one
  const generation = useRef(0);
  const { chosen, skipped, overflow } = selection;

  const take = async (picked: readonly File[]) => {
    const round = generation.current;
    const accepted: Chosen[] = [];
    const left: string[] = [];
    for (const file of picked) {
      const verdict = checkFile(file);
      if (!verdict.ok) {
        const video = isVideoType(file.type) || OTHER_VIDEO.test(file.name);
        left.push(
          verdict.reason === 'size'
            ? mediaText.tooLarge(file.name, video)
            : verdict.reason === 'empty'
              ? mediaText.emptyFile(file.name)
              : video
                ? mediaText.unsupportedVideoFormat(file.name)
                : mediaText.unsupportedFormat(file.name),
        );
        continue;
      }
      // the duration comes from the metadata of the film (a convenience - the server measures it again); an unreadable film is sent
      if (isVideoType(verdict.contentType)) {
        const seconds = await readVideoDuration(file);
        if (seconds !== null && Math.ceil(seconds) > MAX_VIDEO_SECONDS) {
          left.push(mediaText.tooLong(file.name));
          continue;
        }
      }
      lastId.current += 1;
      accepted.push({ id: lastId.current, file, contentType: verdict.contentType });
    }
    if (round !== generation.current) return;
    setSelection((current) => {
      const merged = [...current.chosen, ...accepted];
      return { chosen: merged.slice(0, MAX_BATCH), skipped: [...current.skipped, ...left], overflow: merged.length > MAX_BATCH };
    });
  };

  // The dialog opens empty (or with the files dropped on the drop area): nothing of the last time stays.
  const { open, files } = dialog;
  useEffect(() => {
    if (!open) return;
    generation.current += 1;
    setSelection(EMPTY);
    setWarning(false);
    setCategory(DEFAULT_CATEGORY);
    setDescription('');
    setStage(NO_STAGE);
    if (files.length > 0) void take(files);
  }, [open, files]);

  const large = chosen.filter((entry) => isVideoType(entry.contentType) && entry.file.size > LARGE_VIDEO_BYTES);

  const submit = () => {
    const contentTypes = new Map(chosen.map((entry) => [entry.file, entry.contentType]));
    closeDialog();
    void engine.add(
      chosen.map((entry) => entry.file),
      {
        category,
        description: description.trim(),
        procedureStageId: stage === NO_STAGE || !stages.choices.some((choice) => choice.id === stage) ? null : stage,
        contentTypes,
        unfinished: sessions,
      },
    );
  };

  // A film over 100 MB: one more step before anything is sent (EVM-046 AC8; the browser cannot tell a mobile network, so the size decides).
  const send = () => {
    if (large.length > 0 && !warning) setWarning(true);
    else submit();
  };

  if (warning) {
    const others = chosen.length - large.length;
    const photosAmongOthers = chosen.filter((entry) => !large.includes(entry)).every((entry) => !isVideoType(entry.contentType));
    return (
      <Dialog
        open={open}
        title={mediaText.dialogTitle}
        closeLabel={mediaText.closeDialog}
        onDismiss={closeDialog}
        actions={
          <>
            <Button
              variant="tertiary"
              onClick={() => {
                setWarning(false);
              }}
            >
              {mediaText.cancel}
            </Button>
            <Button onClick={send}>{mediaText.sendNow}</Button>
          </>
        }
      >
        <Banner icon={TriangleAlert} label={mediaText.largeVideoLabel}>
          <p>
            {mediaText.largeVideo(
              large.reduce((sum, entry) => sum + entry.file.size, 0),
              large.length,
            )}
          </p>
        </Banner>
        <ul className="flex flex-col gap-stack-xs">
          {large.map((entry) => (
            <li key={entry.id} className="break-words text-body">
              {entry.file.name}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <p className="text-body">{mediaText.togetherWith(large.length, photosAmongOthers ? photosCount(others) : filesCount(others))}</p>
        ) : null}
      </Dialog>
    );
  }

  const total = chosen.reduce((sum, entry) => sum + entry.file.size, 0);
  return (
    <Dialog
      open={open}
      title={mediaText.dialogTitle}
      closeLabel={mediaText.closeDialog}
      onDismiss={closeDialog}
      actions={
        <>
          <Button variant="tertiary" onClick={closeDialog}>
            {mediaText.cancel}
          </Button>
          <Button disabled={chosen.length === 0} onClick={send}>
            {mediaText.send(chosen.length)}
          </Button>
        </>
      }
    >
      <p className="text-body text-text-secondary">{mediaText.dialogIntro}</p>
      <InlineAlert tone="info">{mediaText.dialogPrivacy}</InlineAlert>
      <Uploader
        variant="button"
        buttonLabel={mediaText.chooseFromGallery}
        buttonIcon={Images}
        inputLabel={mediaText.chosenFilesInput}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov"
        hint={mediaText.limits}
        onFiles={(picked) => {
          void take(picked);
        }}
      />
      {chosen.length === 0 ? null : (
        <div className="flex flex-col gap-stack-sm">
          <p className="text-label text-text-primary">{mediaText.chosen(chosen.length, total)}</p>
          <ul className="flex flex-col gap-stack-xs">
            {chosen.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-inline-md">
                <span className="min-w-0 break-words text-body">{`${entry.file.name} · ${formatBytes(entry.file.size)}`}</span>
                <Button
                  variant="tertiary"
                  size="lg"
                  aria-label={mediaText.removeFromChoice(entry.file.name)}
                  onClick={() => {
                    setSelection((current) => ({
                      ...current,
                      chosen: current.chosen.filter((other) => other.id !== entry.id),
                      overflow: false,
                    }));
                  }}
                >
                  {mediaText.removeFromChoiceShort}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {overflow ? <InlineAlert tone="info">{mediaText.tooMany}</InlineAlert> : null}
      {skipped.length === 0 ? null : (
        <div className="flex flex-col gap-stack-xs" role="status">
          <p className="text-label text-text-primary">{mediaText.skipped(skipped.length)}</p>
          <ul className="flex flex-col gap-stack-xs text-body-sm text-text-secondary">
            {skipped.map((message, index) => (
              <li key={`${message}-${String(index)}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <Select
        label={mediaText.category}
        value={category}
        options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
        onChange={(value) => {
          setCategory(value as MediaCategory);
        }}
      />
      <Select label={mediaText.stage} value={stage} options={stageSelectOptions(stages.choices, mediaText.noStage)} onChange={setStage} />
      {stages.failed ? <InlineAlert tone="error">{mediaText.stagesFailed}</InlineAlert> : null}
      <TextArea
        label={mediaText.description}
        value={description}
        rows={2}
        hint={mediaText.descriptionReminder}
        onChange={(event) => {
          setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
        }}
      />
    </Dialog>
  );
}
