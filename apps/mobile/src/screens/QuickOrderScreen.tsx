import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import {
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  buildQuickOrderInput,
  draftSiteType,
  findSimilarCustomers,
  hasInput,
  initialDraft,
  templatesFor,
  validateQuickOrder,
  type QuickError,
  type QuickField,
  type QuickOrderDraft,
  type QuickOrderSource,
} from '../orders/quick-order-model';
import type { PhoneTemplate, TemplateSet } from '../orders/templates';
import { AlertDialog, AppBar, BottomBar, Button, EmptyState, Inbox, InlineAlert, Lock, Skeleton, TextArea, TextField } from '../ui';
import { color, space, text } from '../ui/theme';
import { CustomerSection, SiteSection, SiteTypeDialog, TemplateSection, errorMessages, errorProp, type Patch } from './QuickOrderSections';
import { SAVE_PROBLEM_KEYS, errorKey } from './quick-order-text';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useSession } from './session-context';

type SaveProblem = 'storage' | 'too_large' | 'failed';

/** The code of the queue -> what the user is told (never the typed data; the codes of `AttentionResult` are fixed). */
function problemOf(code: string): SaveProblem {
  if (code === 'storage_failure') return 'storage';
  if (code === 'payload_too_large') return 'too_large';
  return 'failed';
}

type Loaded = { readonly source: QuickOrderSource; readonly templates: TemplateSet | null };
type Load = { readonly kind: 'loading' } | { readonly kind: 'error' } | ({ readonly kind: 'ready' } & Loaded);

/** The keys of the draft that change what "podobny klient" compares: a change withdraws the question asked before saving. */
const SIMILARITY_KEYS: readonly (keyof QuickOrderDraft)[] = ['customerMode', 'kind', 'firstName', 'lastName', 'companyName', 'phone'];

/**
 * M-10 "Nowe zlecenie", the phone version (EVM-106 AC1-AC3, AC6): a quick work order (customer, place, template, title, note) written
 * into the durable queue of the phone as `CreateQuickWorkOrder`. The rules the screen keeps (security plan of the story):
 * - the typed data live ONLY in the state of this component: they go to `session.sync.enqueue` (SQLCipher) and nowhere else - no draft,
 *   no navigation parameter, no log, no toast, no announcement with data; the shell holds `{stage: 'quick'}` only;
 * - the customers and places of the phone are read once when the form opens and held in memory only while it is open; in the hidden-data
 *   mode nothing is read, nothing is drawn and the state is dropped in the same render (fail-closed);
 * - the form closes only after `enqueue` answered `ok` (the command is durable BEFORE the user is told); every failure keeps the data and
 *   says the reason without them; one touch = one command (a flag blocks the next save until the answer; every save takes new ids);
 * - the checks equal the contract (the server stays the source of truth); a similar customer is a local hint, asked once before saving.
 */
export function QuickOrderScreen({ onClose, onSaved }: { onClose: () => void; onSaved: (workOrderId: string) => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const hidden = useGuard().hidden !== null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [draft, setDraft] = useState<QuickOrderDraft | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [similarAsk, setSimilarAsk] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const titleEdited = useRef(false);
  const summary = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // the sources are read once per opening; the hidden-data mode reads nothing and drops what is held
  useEffect(() => {
    if (hidden) {
      setLoad({ kind: 'loading' });
      setDraft(null);
      return undefined;
    }
    let active = true;
    Promise.all([session.sync.quickOrderSource(), session.sync.templates()]).then(
      ([source, templates]) => {
        if (!active) return;
        setLoad({ kind: 'ready', source, templates });
        setDraft((current) => current ?? initialDraft(source));
      },
      () => {
        if (active) setLoad({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [hidden, session.sync]);

  const requestClose = useCallback(() => {
    if (draft !== null && hasInput(draft)) setDiscardAsk(true);
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

  const set = useCallback((patch: Patch) => {
    setProblem(null);
    if (SIMILARITY_KEYS.some((key) => key in patch)) setSimilarAsk(false);
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  if (hidden) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="quick-order-hidden">
        <AppBar
          title={t('quickOrder.title')}
          left={<Button label={t('quickOrder.close')} variant="tertiary" inverse onPress={onClose} testID="quick-order-hidden-close" />}
        />
        <EmptyState icon={Lock} title={t('quickOrder.hidden')} testID="quick-order-hidden-notice" />
      </View>
    );
  }

  const ready = load.kind === 'ready' && draft !== null;
  const templates: readonly PhoneTemplate[] = load.kind === 'ready' ? (load.templates?.items ?? []) : [];
  const source: QuickOrderSource = load.kind === 'ready' ? load.source : { customers: [], sites: [] };
  const errors: readonly QuickError[] = submitted && draft !== null ? validateQuickOrder(draft, source, templates) : [];
  const message = (error: QuickError): string =>
    t(errorKey(error.field, error.problem), { max: error.field === 'note' ? MAX_NOTE_LENGTH : MAX_TITLE_LENGTH });
  const errorOf = (field: QuickField): string | undefined => {
    const found = errors.find((error) => error.field === field);
    return found === undefined ? undefined : message(found);
  };

  const save = (current: QuickOrderDraft): void => {
    if (busy.current) return;
    setSubmitted(true);
    const built = buildQuickOrderInput(current, source, templates, session.newId);
    if (!built.ok) {
      setFocusTick((tick) => tick + 1);
      return;
    }
    if (!similarAsk && findSimilarCustomers(current, source.customers).length > 0) {
      setSimilarAsk(true);
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

  const content = () => {
    if (load.kind === 'loading' || (load.kind === 'ready' && draft === null)) {
      return <Skeleton accessibilityLabel={t('quickOrder.loading')} testID="quick-order-skeleton" />;
    }
    if (load.kind === 'error' || draft === null) {
      return <EmptyState icon={Inbox} title={t('quickOrder.loadFailed')} testID="quick-order-error" />;
    }
    const siteType = draftSiteType(draft, source);
    const visible = templatesFor(templates, siteType, showAll);
    const narrowed = templatesFor(templates, siteType, false).length < templates.length;
    const lines = errorMessages(errors, message);
    const hasSimilar = similarAsk;
    const noTemplates = templates.length === 0;
    return (
      <>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.lg }}
          testID="quick-order-scroll"
        >
          <View ref={summary} accessible={lines.length > 0 || hasSimilar} testID="quick-order-summary">
            {lines.length > 0 ? (
              <InlineAlert tone="error" title={t('quickOrder.summaryTitle')} body={lines.join('\n')} testID="quick-order-errors" />
            ) : null}
          </View>
          <Text style={{ ...text.body, color: color.text.secondary }}>{t('quickOrder.numberInfo')}</Text>
          <CustomerSection draft={draft} source={source} set={set} errorOf={errorOf} similarAsk={similarAsk} />
          <SiteSection
            draft={draft}
            source={source}
            set={set}
            errorOf={errorOf}
            onOpenType={() => {
              setTypeOpen(true);
            }}
          />
          <TemplateSection
            templates={visible}
            all={templates.length}
            filtered={narrowed}
            chosen={draft.templateId}
            showAll={showAll}
            onShowAll={() => {
              setShowAll((value) => !value);
            }}
            onPick={(template) => {
              const replace = !titleEdited.current || draft.title.trim() === '';
              set({ templateId: template.id, ...(replace ? { title: template.name.slice(0, MAX_TITLE_LENGTH) } : {}) });
            }}
            error={errorOf('template')}
          />
          <TextField
            label={t('quickOrder.titleLabel')}
            value={draft.title}
            onChangeText={(title) => {
              titleEdited.current = true;
              set({ title });
            }}
            privateData
            autoCapitalize="sentences"
            {...errorProp(errorOf('title'))}
            testID="quick-title"
          />
          <TextArea
            label={t('quickOrder.noteLabel')}
            value={draft.note}
            onChangeText={(note) => {
              set({ note });
            }}
            hint={t('quickOrder.noteHint')}
            {...errorProp(errorOf('note'))}
            testID="quick-note"
          />
        </ScrollView>
        <BottomBar>
          {problem === null ? null : <InlineAlert tone="error" body={t(SAVE_PROBLEM_KEYS[problem])} testID="quick-order-alert" />}
          <Button
            label={t('quickOrder.save')}
            buttonSize="lg"
            fullWidth
            busy={saving}
            disabled={noTemplates}
            onPress={() => {
              save(draft);
            }}
            testID="quick-order-save"
          />
        </BottomBar>
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: color.bg.canvas }}
      testID="quick-order"
    >
      <AppBar
        title={t('quickOrder.title')}
        left={
          <Button
            label={t('quickOrder.close')}
            accessibilityLabel={t('quickOrder.closeA11y')}
            variant="tertiary"
            inverse
            onPress={requestClose}
            testID="quick-order-close"
          />
        }
        // the queue is not opened from here: leaving the form would drop the data (a tap only starts a synchronization cycle)
        right={<SyncCapsule onPress={() => undefined} />}
      />
      {content()}
      {ready && typeOpen ? (
        <SiteTypeDialog
          onPick={(value) => {
            setTypeOpen(false);
            set({ siteType: value });
          }}
          onCancel={() => {
            setTypeOpen(false);
          }}
        />
      ) : null}
      {discardAsk ? (
        <AlertDialog
          title={t('quickOrder.discardTitle')}
          onCancel={() => {
            setDiscardAsk(false);
          }}
          testID="quick-order-discard-dialog"
          actions={
            <>
              <Button
                label={t('quickOrder.discardBack')}
                onPress={() => {
                  setDiscardAsk(false);
                }}
                fullWidth
                testID="quick-order-discard-back"
              />
              <Button
                variant="dangerTertiary"
                label={t('quickOrder.discardConfirm')}
                onPress={onClose}
                fullWidth
                testID="quick-order-discard-confirm"
              />
            </>
          }
        >
          <Text style={{ ...text.body, color: color.text.primary }}>{t('quickOrder.discardBody')}</Text>
        </AlertDialog>
      ) : null}
    </KeyboardAvoidingView>
  );
}
