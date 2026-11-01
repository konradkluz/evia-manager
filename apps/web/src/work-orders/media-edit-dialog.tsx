import type { MediaAsset, MediaCategory, UpdateMediaAssetRequest } from '@evia/contracts';
import { Button, Dialog, InlineAlert, Select, TextArea } from '@evia/ui-web';
import { useEffect, useState } from 'react';
import { useOnline } from '../shell/use-online.ts';
import { categoryLabel, mediaCategoryLabels, mediaText } from './media-labels.ts';
import { isStageRejection, NO_STAGE, stageSelectOptions, useStageChoices } from './stage-choice.ts';
import { editFailure, useUpdateMedia } from './use-media.ts';

const CATEGORIES = Object.keys(mediaCategoryLabels) as MediaCategory[];
const DESCRIPTION_MAX = 1000;

/**
 * "Edytuj opis" of a medium from the lightbox (W-09; EVM-048 AC2, AC8): the category, the description (text only, with the reminder about PESEL) and the
 * stage of the order. The change goes with the version of the medium (`If-Match`): on `412` the data on the server stay, the dialog stays open with
 * what was typed and the list is read again. A stage that is gone gives a message and a fresh list of stages. Offline the save is off.
 */
export function MediaEditDialog({
  workOrderId,
  asset,
  onClose,
}: {
  readonly workOrderId: string;
  readonly asset: MediaAsset | null;
  readonly onClose: () => void;
}) {
  const online = useOnline();
  const update = useUpdateMedia(workOrderId);
  const stages = useStageChoices(workOrderId);
  const [category, setCategory] = useState<MediaCategory>('other');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState(NO_STAGE);
  const [failure, setFailure] = useState<string | null>(null);
  const assetId = asset?.id ?? null;

  // The form starts again for every medium (a refresh of the list after `412` must not wipe what was typed).
  useEffect(() => {
    if (asset === null) return;
    setCategory(asset.category);
    setDescription(asset.description ?? '');
    setStage(asset.procedureStageId ?? NO_STAGE);
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // The stages are read again when the dialog opens: a stage removed meanwhile is not offered.
  const { refresh } = stages;
  useEffect(() => {
    if (assetId !== null) void refresh();
  }, [assetId, refresh]);

  const known = stages.choices.some((choice) => choice.id === stage);
  const options = stageSelectOptions(stages.choices, mediaText.noStage);

  const submit = () => {
    if (asset === null) return;
    setFailure(null);
    const text = description.trim();
    const wanted = text === '' ? null : text;
    // only what changed is sent: a stage that was removed meanwhile is not touched by an edit of the description
    const patch: UpdateMediaAssetRequest = {
      ...(category === asset.category ? {} : { category }),
      ...(wanted === asset.description ? {} : { description: wanted }),
      ...((stage === NO_STAGE ? null : stage) === asset.procedureStageId ? {} : { procedureStageId: stage === NO_STAGE ? null : stage }),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { asset, patch },
      {
        onSuccess: onClose,
        onError: (error) => {
          setFailure(editFailure(error));
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
      open={asset !== null}
      size="sm"
      title={mediaText.editTitle}
      closeLabel={mediaText.closeDialog}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {mediaText.cancel}
          </Button>
          <Button loading={update.isPending} disabled={!online} onClick={submit}>
            {mediaText.editSave}
          </Button>
        </>
      }
    >
      {online ? null : <InlineAlert tone="info">{mediaText.editOffline}</InlineAlert>}
      <Select
        label={mediaText.category}
        value={category}
        options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
        onChange={(value) => {
          setCategory(value as MediaCategory);
        }}
      />
      <Select
        label={mediaText.stage}
        // an assigned stage that is no longer on the list (removed) is not offered; saving then clears it
        value={known ? stage : NO_STAGE}
        options={options}
        onChange={setStage}
      />
      {stages.failed ? <InlineAlert tone="error">{mediaText.stagesFailed}</InlineAlert> : null}
      <TextArea
        label={mediaText.description}
        value={description}
        rows={3}
        hint={mediaText.descriptionReminder}
        onChange={(event) => {
          setDescription(event.target.value.slice(0, DESCRIPTION_MAX));
        }}
      />
      {failure === null ? null : <InlineAlert tone="error">{failure}</InlineAlert>}
    </Dialog>
  );
}
