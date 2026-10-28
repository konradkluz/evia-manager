import type { MediaCategory } from '@evia/contracts';
import { Button, Dialog, Images, InlineAlert, Select, TextArea, Uploader } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { checkFile, MAX_BATCH } from './media-files.ts';
import { categoryLabel, formatBytes, mediaCategoryLabels, mediaText } from './media-labels.ts';
import type { MediaUpload } from './use-media.ts';

const CATEGORIES = Object.keys(mediaCategoryLabels) as MediaCategory[];
/** The category of the mockup W-09: the usual photo of the work in progress. */
const DEFAULT_CATEGORY: MediaCategory = 'in_progress';
const DESCRIPTION_MAX = 1000;

interface Chosen {
  readonly file: File;
  readonly contentType: string;
}

/**
 * The dialog "Dodaj zdjęcia lub filmy" (W-09, W-09 w przeglądarce telefonu 2–3; EVM-044 AC1, AC2, AC4): the system picker of files
 * ("Wybierz z galerii"), the chosen files with their sizes and "Usuń z wyboru", the files left out with the reason (SVG, HTML,
 * archives and everything over 50 MB never leave the tab — the server checks the content again), the category and the description,
 * and "Wyślij N plików". A file that fits an unfinished session of the person resumes it instead of making a new medium (AC4).
 * The chosen files live in the state of the dialog only (memory of the tab; nothing in the storage of the browser — SR-WEB-05).
 */
export function MediaUploadDialog({ media }: { readonly media: MediaUpload }) {
  const { dialog, closeDialog, engine, sessions } = media;
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [category, setCategory] = useState<MediaCategory>(DEFAULT_CATEGORY);
  const [description, setDescription] = useState('');

  const take = (picked: readonly File[], base: readonly Chosen[] = chosen, before: readonly string[] = skipped) => {
    const accepted: Chosen[] = [];
    const left: string[] = [];
    for (const file of picked) {
      const verdict = checkFile(file);
      if (verdict.ok) accepted.push({ file, contentType: verdict.contentType });
      else
        left.push(
          verdict.reason === 'size'
            ? mediaText.tooLarge(file.name)
            : verdict.reason === 'empty'
              ? mediaText.emptyFile(file.name)
              : mediaText.unsupportedFormat(file.name),
        );
    }
    const merged = [...base, ...accepted];
    setOverflow(merged.length > MAX_BATCH);
    setChosen(merged.slice(0, MAX_BATCH));
    setSkipped([...before, ...left]);
  };

  // The dialog opens empty (or with the files dropped on the drop area): nothing of the last time stays.
  const { open, files } = dialog;
  useEffect(() => {
    if (!open) return;
    setChosen([]);
    setSkipped([]);
    setOverflow(false);
    setCategory(DEFAULT_CATEGORY);
    setDescription('');
    if (files.length > 0) take(files, [], []);
    // `take` only reads its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, files]);

  const send = () => {
    const contentTypes = new Map(chosen.map((entry) => [entry.file, entry.contentType]));
    closeDialog();
    void engine.add(
      chosen.map((entry) => entry.file),
      { category, description: description.trim(), contentTypes, unfinished: sessions },
    );
  };

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
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
        hint={mediaText.limits}
        onFiles={take}
      />
      {chosen.length === 0 ? null : (
        <div className="flex flex-col gap-stack-sm">
          <p className="text-label text-text-primary">{mediaText.chosen(chosen.length, total)}</p>
          <ul className="flex flex-col gap-stack-xs">
            {chosen.map((entry, index) => (
              <li key={`${entry.file.name}-${String(index)}`} className="flex flex-wrap items-center justify-between gap-inline-md">
                <span className="min-w-0 break-words text-body">{`${entry.file.name} · ${formatBytes(entry.file.size)}`}</span>
                <Button
                  variant="tertiary"
                  aria-label={mediaText.removeFromChoice(entry.file.name)}
                  onClick={() => {
                    setChosen((current) => current.filter((_, position) => position !== index));
                    setOverflow(false);
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
