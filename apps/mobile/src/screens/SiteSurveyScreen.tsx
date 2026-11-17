import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import {
  buildSurveyInput,
  EMPTY_SURVEY_DRAFT,
  hasSurveyInput,
  validateSurvey,
  type SurveyDraft,
  type SurveyError,
  type SurveyField,
} from '../orders/site-survey-model';
import { AlertDialog, AppBar, BottomBar, Button, EmptyState, EyeOff, InlineAlert, TextField } from '../ui';
import { color, space, text } from '../ui/theme';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useSession } from './session-context';
import { SURVEY_SAVE_PROBLEM_KEYS, surveyErrorKey } from './site-survey-text';

type SaveProblem = 'storage' | 'too_large' | 'failed';

/** The code of the queue -> what the user is told (never the typed data; the codes of `AttentionResult` are fixed). */
function problemOf(code: string): SaveProblem {
  if (code === 'storage_failure') return 'storage';
  if (code === 'payload_too_large') return 'too_large';
  return 'failed';
}

const errorProp = (message: string | undefined): { error?: string } => (message === undefined ? {} : { error: message });

/**
 * M-10 "Wizja lokalna", the phone version (EVM-137 AC1, AC2, AC5): an address and one optional phone of the requester written into the
 * durable queue of the phone as `CreateSiteSurvey`. The rules the screen keeps (security W5, W8, W9; the same as the quick order form):
 * - the typed data live ONLY in the state of this component: they go to `session.sync.enqueue` (SQLCipher) and nowhere else - no draft, no
 *   navigation parameter, no log, no toast, no announcement with data; the shell holds `{stage: 'survey'}` only;
 * - there is no field for a client, a template, a title or a note (free text would take names), and the phone has its own hint;
 * - the form closes only after `enqueue` answered `ok` (the command is durable BEFORE the user is told); every failure keeps the data and
 *   says the reason without them; one touch = one command (a flag blocks the next save until the answer; every save takes new ids);
 * - in the hidden-data mode the form is not drawn and the state is dropped in the same render (fail-closed); the notice says photos go on.
 */
export function SiteSurveyScreen({ onClose, onSaved }: { onClose: () => void; onSaved: (workOrderId: string) => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const hidden = useGuard().hidden !== null;
  const [draft, setDraft] = useState<SurveyDraft>(EMPTY_SURVEY_DRAFT);
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const summary = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // the hidden-data mode drops what was typed (nothing is kept for later)
  useEffect(() => {
    if (hidden) {
      setDraft(EMPTY_SURVEY_DRAFT);
      setSubmitted(false);
      setProblem(null);
      setDiscardAsk(false);
    }
  }, [hidden]);

  const requestClose = useCallback(() => {
    if (hasSurveyInput(draft)) setDiscardAsk(true);
    else onClose();
  }, [draft, onClose]);
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
  // after a failed save the summary takes the focus of the screen reader and the form scrolls to it
  useEffect(() => {
    if (focusTick === 0) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (summary.current !== null) AccessibilityInfo.sendAccessibilityEvent(summary.current, 'focus');
  }, [focusTick]);

  const set = useCallback((patch: Partial<SurveyDraft>) => {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  if (hidden) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="site-survey-hidden">
        <AppBar
          title={t('siteSurvey.title')}
          left={<Button label={t('siteSurvey.close')} variant="tertiary" inverse onPress={onClose} testID="site-survey-hidden-close" />}
        />
        <EmptyState icon={EyeOff} title={t('siteSurvey.hidden')} testID="site-survey-hidden-notice" />
      </View>
    );
  }

  const errors: readonly SurveyError[] = submitted ? validateSurvey(draft) : [];
  const message = (error: SurveyError): string => t(surveyErrorKey(error.field, error.problem));
  const errorOf = (field: SurveyField): string | undefined => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? undefined : message(found);
  };
  const lines = [...new Set(errors.map(message))];

  const save = (): void => {
    if (busy.current) return;
    setSubmitted(true);
    const built = buildSurveyInput(draft, session.newId);
    if (!built.ok) {
      setFocusTick((tick) => tick + 1);
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
        if (result.ok) onSaved(built.workOrderId);
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: color.bg.canvas }}
      testID="site-survey"
    >
      <AppBar
        title={t('siteSurvey.title')}
        left={
          <Button
            label={t('siteSurvey.close')}
            accessibilityLabel={t('siteSurvey.closeA11y')}
            variant="tertiary"
            inverse
            onPress={requestClose}
            testID="survey-close"
          />
        }
        // the queue is not opened from here: leaving the form would drop the data (a tap only starts a synchronization cycle)
        right={<SyncCapsule onPress={() => undefined} />}
      />
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.lg }}
        testID="survey-scroll"
      >
        <View ref={summary} accessible={lines.length > 0} testID="survey-summary">
          {lines.length > 0 ? (
            <InlineAlert tone="error" title={t('siteSurvey.summaryTitle')} body={lines.join('\n')} testID="survey-errors" />
          ) : null}
        </View>
        <Text style={{ ...text.body, color: color.text.secondary }}>{t('siteSurvey.numberInfo')}</Text>
        <View style={{ rowGap: space.stack.sm }}>
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('siteSurvey.address')}
          </Text>
          <TextField
            label={t('siteSurvey.city')}
            value={draft.city}
            onChangeText={(city) => {
              set({ city });
            }}
            privateData
            autoCapitalize="words"
            maxLength={100}
            {...errorProp(errorOf('city'))}
            testID="survey-city"
          />
          <TextField
            label={t('siteSurvey.street')}
            value={draft.street}
            onChangeText={(street) => {
              set({ street });
            }}
            privateData
            autoCapitalize="words"
            maxLength={200}
            {...errorProp(errorOf('street'))}
            testID="survey-street"
          />
          <TextField
            label={t('siteSurvey.buildingNumber')}
            value={draft.buildingNumber}
            onChangeText={(buildingNumber) => {
              set({ buildingNumber });
            }}
            privateData
            maxLength={30}
            {...errorProp(errorOf('buildingNumber'))}
            testID="survey-building"
          />
          <TextField
            label={t('siteSurvey.apartmentNumber')}
            value={draft.apartmentNumber}
            onChangeText={(apartmentNumber) => {
              set({ apartmentNumber });
            }}
            privateData
            maxLength={30}
            {...errorProp(errorOf('apartmentNumber'))}
            testID="survey-apartment"
          />
          <TextField
            label={t('siteSurvey.postalCode')}
            value={draft.postalCode}
            onChangeText={(postalCode) => {
              set({ postalCode });
            }}
            privateData
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            {...errorProp(errorOf('postalCode'))}
            testID="survey-postal"
          />
        </View>
        <TextField
          label={t('siteSurvey.requesterPhone')}
          value={draft.requesterPhone}
          onChangeText={(requesterPhone) => {
            set({ requesterPhone });
          }}
          hint={t('siteSurvey.phoneHint')}
          privateData
          keyboardType="phone-pad"
          maxLength={40}
          {...errorProp(errorOf('requesterPhone'))}
          testID="survey-phone"
        />
        <InlineAlert tone="info" body={t('siteSurvey.term')} testID="survey-term" />
      </ScrollView>
      <BottomBar>
        {problem === null ? null : <InlineAlert tone="error" body={t(SURVEY_SAVE_PROBLEM_KEYS[problem])} testID="survey-alert" />}
        <Button label={t('siteSurvey.save')} buttonSize="lg" fullWidth busy={saving} onPress={save} testID="survey-save" />
      </BottomBar>
      {discardAsk ? (
        <AlertDialog
          title={t('siteSurvey.discardTitle')}
          onCancel={() => {
            setDiscardAsk(false);
          }}
          testID="survey-discard-dialog"
          actions={
            <>
              <Button
                label={t('siteSurvey.discardBack')}
                onPress={() => {
                  setDiscardAsk(false);
                }}
                fullWidth
                testID="survey-discard-back"
              />
              <Button
                variant="dangerTertiary"
                label={t('siteSurvey.discardConfirm')}
                onPress={onClose}
                fullWidth
                testID="survey-discard-confirm"
              />
            </>
          }
        >
          <Text style={{ ...text.body, color: color.text.primary }}>{t('siteSurvey.discardBody')}</Text>
        </AlertDialog>
      ) : null}
    </KeyboardAvoidingView>
  );
}
