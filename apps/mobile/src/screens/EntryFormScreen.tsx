import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  buildEntryInput,
  DEFAULT_CATEGORY,
  MAX_BODY_LENGTH,
  NOTE_CATEGORIES,
  stageChoices,
  type BodyProblem,
  type EntryKind,
  type NoteCategory,
} from '../orders/entry-form-model';
import type { OrderDetail } from '../orders/order-detail-model';
import { AlertDialog, AppBar, BottomBar, Button, EmptyState, FilterChip, Inbox, InlineAlert, Skeleton, TextArea } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';
import { SyncCapsule } from './SyncCapsule';
import { useOrderDetail } from './order-detail-hooks';
import { useSession } from './session-context';

type SaveProblem = BodyProblem | 'storage' | 'too_large' | 'failed';

const CATEGORY_LABEL: Readonly<Record<NoteCategory, string>> = {
  phone_call: 'orderDetail.category.phone_call',
  meeting: 'orderDetail.category.meeting',
  arrangement: 'orderDetail.category.arrangement',
  site_visit: 'orderDetail.category.site_visit',
  other: 'orderDetail.category.other',
};

/** The code of the queue -> what the user is told (never the text; the codes of `AttentionResult` are fixed). */
function problemOf(code: string): SaveProblem {
  if (code === 'storage_failure') return 'storage';
  if (code === 'payload_too_large') return 'too_large';
  return 'failed';
}

/** The button that opens the stage list; the list itself (AlertDialog) is drawn by the form at the root of the screen, not in the scroll. */
function StageSelect({ detail, value, onOpen }: { detail: OrderDetail; value: string | null; onOpen: () => void }) {
  const { t } = useTranslation();
  const chosen = stageChoices(detail).find((choice) => choice.id === value);
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('entryForm.stageLabel')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('entryForm.stageA11y', { value: chosen === undefined ? t('entryForm.stageNone') : chosen.name })}
        onPress={onOpen}
        testID="entry-stage"
        style={({ pressed }) => ({
          minHeight: size.control.height.mobile.md,
          justifyContent: 'center',
          paddingHorizontal: space.inset.md,
          borderRadius: radius.control,
          borderWidth: borderWidth.default,
          borderColor: color.border.strong,
          backgroundColor: pressed ? color.bg.surfacePressed : color.control.bg,
        })}
      >
        <Text style={{ ...text.body, color: chosen === undefined ? color.control.placeholder : color.text.primary }}>
          {chosen === undefined ? t('entryForm.stageChoose') : chosen.name}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * M-04 "Nowy wpis", the phone version (EVM-105 AC1-AC4): a note (category, optional stage of this order, text) or a comment, written
 * into the durable queue of the phone. The rules the screen keeps (security plan of the story):
 * - the text lives ONLY in the state of this component: it goes to `session.sync.enqueue` (SQLCipher) and nowhere else - no draft, no
 *   navigation parameter, no log, no toast, no announcement; the shell holds the id of the order only;
 * - the form closes and the text is cleared only after `enqueue` answered `ok` (the file is durable BEFORE the user is told); every
 *   failure keeps the text and tells the reason without it;
 * - one touch = one mutation: a flag blocks the next save until the answer; every save takes a new id;
 * - hidden-data mode and the end of the session: the hook returns `hidden` in the same render (nothing is drawn) and the shell
 *   unmounts the form, so the text is gone.
 */
export function EntryFormScreen({ orderId, onClose, onSaved }: { orderId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const { state, retry } = useOrderDetail(orderId);
  const [kind, setKind] = useState<EntryKind>('note');
  const [category, setCategory] = useState<NoteCategory>(DEFAULT_CATEGORY);
  const [stageId, setStageId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  // a non-empty text is never dropped by one touch or one gesture (no draft exists in M2): ask first
  const hasText = body.trim() !== '';
  const requestClose = useCallback(() => {
    if (hasText) setDiscardAsk(true);
    else onClose();
  }, [hasText, onClose]);
  // registered after the shell's handler (which leaves the open form to us) and before the dialogs' own handlers, which win while open
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [requestClose]);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const errorText = (value: SaveProblem): string => {
    switch (value) {
      case 'empty':
        return t('entryForm.errors.empty');
      case 'too_long':
        return t('entryForm.errors.too_long', { max: MAX_BODY_LENGTH });
      case 'invalid':
        return t('entryForm.errors.invalid');
      case 'storage':
        return t('entryForm.errors.storage');
      case 'too_large':
        return t('entryForm.errors.too_large');
      case 'failed':
        return t('entryForm.errors.failed');
    }
  };

  const save = (detail: OrderDetail): void => {
    if (busy.current) return;
    const built = buildEntryInput(
      { kind, workOrderId: detail.id, category, stageId, stages: stageChoices(detail), body },
      Date.now(),
      session.newId,
    );
    if (!built.ok) {
      setProblem(built.problem);
      field.current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setProblem(null);
    session.sync.enqueue(built.input).then(
      (result) => {
        busy.current = false;
        if (!alive.current) return;
        setSaving(false);
        if (result.ok) onSaved();
        else setProblem(problemOf(result.code));
      },
      () => {
        busy.current = false;
        if (!alive.current) return;
        setSaving(false);
        setProblem('failed');
      },
    );
  };

  const fieldProblem = problem === 'empty' || problem === 'too_long' || problem === 'invalid' ? problem : null;
  const bannerProblem = problem !== null && fieldProblem === null ? problem : null;

  const closeStage = () => {
    setStageOpen(false);
  };
  // drawn as a sibling of the scroll (the dialog fills its parent: here the whole screen), never inside the ScrollView
  const stageDialog = (detail: OrderDetail) => {
    const choices = stageChoices(detail);
    const several = detail.processes.length > 1;
    return (
      <AlertDialog
        title={t('entryForm.stageDialogTitle')}
        onCancel={closeStage}
        testID="entry-stage-dialog"
        actions={
          <Button variant="tertiary" label={t('entryForm.stageCancel')} onPress={closeStage} fullWidth testID="entry-stage-cancel" />
        }
      >
        <View style={{ rowGap: space.stack.xs }}>
          <Button
            variant="tertiary"
            label={t('entryForm.stageNone')}
            onPress={() => {
              setStageId(null);
              closeStage();
            }}
            fullWidth
            testID="entry-stage-none"
          />
          {choices.map((choice) => (
            <Button
              key={choice.id}
              variant="tertiary"
              label={several ? t('entryForm.stageOption', { process: choice.process, name: choice.name }) : choice.name}
              onPress={() => {
                setStageId(choice.id);
                closeStage();
              }}
              fullWidth
              testID={`entry-stage-${choice.id}`}
            />
          ))}
        </View>
      </AlertDialog>
    );
  };

  const content = () => {
    switch (state.kind) {
      case 'hidden':
        // the shell does not mount the form in the mode and unmounts it when the mode starts; if a render ever gets here, nothing is drawn
        return null;
      case 'loading':
        return <Skeleton accessibilityLabel={t('shell.loading.label')} testID="entry-skeleton" />;
      case 'error':
        return (
          <EmptyState
            icon={Inbox}
            title={t('entryForm.loadFailed')}
            testID="entry-error"
            action={<Button label={t('shell.retry')} onPress={retry} testID="entry-retry" />}
          />
        );
      case 'unavailable':
        return (
          <EmptyState
            icon={Inbox}
            title={t('entryForm.orderUnavailable')}
            testID="entry-unavailable"
            action={<Button label={t('entryForm.close')} onPress={onClose} testID="entry-unavailable-close" />}
          />
        );
      case 'ready': {
        const { detail } = state;
        return (
          <>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.md }}
              testID="entry-form-scroll"
            >
              <View accessible accessibilityRole="header" testID="entry-order">
                <Text style={{ ...text.heading4, color: color.text.primary }}>
                  {detail.number === null ? detail.title : t('entryForm.picker.option', { number: detail.number, title: detail.title })}
                </Text>
              </View>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('entryForm.kindLabel')}
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.inline.sm }}
              >
                <FilterChip
                  radio
                  label={t('orderDetail.kind.note')}
                  accessibilityLabel={t('orderDetail.kind.note')}
                  selected={kind === 'note'}
                  onPress={() => {
                    setKind('note');
                  }}
                  testID="entry-kind-note"
                />
                <FilterChip
                  radio
                  label={t('orderDetail.kind.comment')}
                  accessibilityLabel={t('orderDetail.kind.comment')}
                  selected={kind === 'comment'}
                  onPress={() => {
                    setKind('comment');
                  }}
                  testID="entry-kind-comment"
                />
              </View>
              {kind === 'note' ? (
                <>
                  <View style={{ rowGap: space.stack.xs }}>
                    <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('entryForm.categoryLabel')}</Text>
                    <View
                      accessibilityRole="radiogroup"
                      accessibilityLabel={t('entryForm.categoryLabel')}
                      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.inline.sm }}
                      testID="entry-categories"
                    >
                      {NOTE_CATEGORIES.map((value) => (
                        <FilterChip
                          key={value}
                          radio
                          label={t(CATEGORY_LABEL[value])}
                          accessibilityLabel={t(CATEGORY_LABEL[value])}
                          selected={category === value}
                          onPress={() => {
                            setCategory(value);
                          }}
                          testID={`entry-category-${value}`}
                        />
                      ))}
                    </View>
                  </View>
                  <StageSelect
                    detail={detail}
                    value={stageId}
                    onOpen={() => {
                      setStageOpen(true);
                    }}
                  />
                </>
              ) : null}
              <TextArea
                label={t('entryForm.bodyLabel')}
                value={body}
                onChangeText={(value) => {
                  setBody(value);
                  setProblem(null);
                }}
                hint={t('entryForm.hint')}
                {...(fieldProblem === null ? {} : { error: errorText(fieldProblem) })}
                inputRef={field}
                editable={!saving}
                testID="entry-body"
              />
              <Text style={{ ...text.bodySm, color: color.text.tertiary }}>{t('entryForm.dictation')}</Text>
            </ScrollView>
            <BottomBar>
              {bannerProblem === null ? null : <InlineAlert tone="error" body={errorText(bannerProblem)} testID="entry-alert" />}
              <Button
                label={t('entryForm.save')}
                buttonSize="lg"
                fullWidth
                busy={saving}
                onPress={() => {
                  save(detail);
                }}
                testID="entry-save"
              />
            </BottomBar>
          </>
        );
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: color.bg.canvas }}
      testID="entry-form"
    >
      <AppBar
        title={t('entryForm.title')}
        left={
          <Button
            label={t('entryForm.close')}
            accessibilityLabel={t('entryForm.closeA11y')}
            variant="tertiary"
            inverse
            onPress={requestClose}
            testID="entry-close"
          />
        }
        // the queue is not opened from here: leaving the form would drop the text (a tap only starts a synchronization cycle)
        right={<SyncCapsule onPress={() => undefined} />}
      />
      {content()}
      {stageOpen && state.kind === 'ready' ? stageDialog(state.detail) : null}
      {discardAsk ? (
        <AlertDialog
          title={t('entryForm.discardTitle')}
          onCancel={() => {
            setDiscardAsk(false);
          }}
          testID="entry-discard-dialog"
          actions={
            <>
              <Button
                label={t('entryForm.discardBack')}
                onPress={() => {
                  setDiscardAsk(false);
                }}
                fullWidth
                testID="entry-discard-back"
              />
              <Button
                variant="dangerTertiary"
                label={t('entryForm.discardConfirm')}
                onPress={onClose}
                fullWidth
                testID="entry-discard-confirm"
              />
            </>
          }
        >
          <Text style={{ ...text.body, color: color.text.primary }}>{t('entryForm.discardBody')}</Text>
        </AlertDialog>
      ) : null}
    </KeyboardAvoidingView>
  );
}
