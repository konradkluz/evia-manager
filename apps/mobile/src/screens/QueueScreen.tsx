import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { formatClock, formatDateTime } from '../i18n/format';
import { pluralKey } from '../i18n/plural';
import type { AttentionReason, QueueItem, TargetOption } from '../sync/types';
import { AlertDialog, AppBar, AttentionCard, Button, EmptyState, InlineAlert, ListChecks, type AttentionAction } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { SyncCapsule } from './SyncCapsule';
import { SyncNotices } from './SyncNotices';
import { useQueueView, useSession } from './session-context';

const NOTICE_MS = 4_000;

/**
 * "Kolejka" (EVM-009 AC1, EVM-101 AC8, EVM-107 AC3, AC4): the number and the state of every element (oczekuje, wysyła się, wysłano,
 * wymaga uwagi). "Wymaga uwagi" elements are cards: age, the reason in plain words, the actions of the table of flow 16, the technical
 * details behind a disclosure; nothing is removed without the user's decision and nothing expires. In the hidden-data mode a row shows
 * its type and state only (the contents are not even requested), and the actions that need the data are not offered.
 */
export function QueueScreen({ onOpenQueue, now = Date.now }: { onOpenQueue: () => void; now?: () => number }) {
  const { t } = useTranslation();
  const session = useSession();
  const { hidden, view, reload } = useQueueView();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: QueueItem; dependents: number } | null>(null);
  const [targets, setTargets] = useState<{ item: QueueItem; options: readonly TargetOption[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const say = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  const types: Readonly<Record<string, string>> = {
    CreateNote: t('queue.types.CreateNote'),
    CreateComment: t('queue.types.CreateComment'),
    CreateQuickWorkOrder: t('queue.types.CreateQuickWorkOrder'),
  };
  const states: Readonly<Record<string, string>> = {
    pending: t('queue.states.pending'),
    sending: t('queue.states.sending'),
    blocked: t('queue.states.blocked'),
    attention: t('queue.states.attention'),
  };
  const reasons: Readonly<Record<AttentionReason, string>> = {
    target_unavailable: t('attention.reasons.target_unavailable'),
    validation_failed: t('attention.reasons.validation_failed'),
    validation_failed_quick: t('attention.reasons.validation_failed_quick'),
    id_conflict: t('attention.reasons.id_conflict'),
    template_unavailable: t('attention.reasons.template_unavailable'),
    quota_exceeded: t('attention.reasons.quota_exceeded'),
    unknown: t('attention.reasons.unknown'),
  };
  const actionLabels: Readonly<Record<string, string>> = {
    retarget: t('attention.actions.retarget'),
    copy: t('attention.actions.copy'),
    recreate: t('attention.actions.recreate'),
    discard: t('attention.actions.discard'),
  };

  const fail = (): void => {
    say(t('attention.failed'));
  };
  const copy = (item: QueueItem): void => {
    // the text is read only when the user asks, never in the hidden-data mode (the action is not offered there)
    void session.sync.copyText(item.id).then(
      (value) => {
        say(value !== null && session.copyToClipboard(value) ? t('attention.copied') : t('attention.copyFailed'));
      },
      () => {
        say(t('attention.copyFailed'));
      },
    );
  };
  const askDiscard = (item: QueueItem): void => {
    void session.sync.dependentsOf(item.id).then((dependents) => {
      setConfirm({ item, dependents });
    }, fail);
  };
  const askRetarget = (item: QueueItem): void => {
    void session.sync.retargetOptions(item.targetId).then((options) => {
      setTargets({ item, options });
    }, fail);
  };

  const cardFor = (item: QueueItem) => {
    const type = types[item.type] ?? t('queue.types.other');
    const reason = reasons[item.reason ?? 'unknown'];
    const actions: AttentionAction[] = item.actions
      // copy and move need the data of the replica: not in the hidden-data mode
      .filter((action) => !hidden || action === 'discard' || action === 'recreate')
      .map((action) => {
        const label = actionLabels[action] ?? '';
        switch (action) {
          case 'copy':
            return {
              key: action,
              label,
              onPress: () => {
                copy(item);
              },
            };
          case 'retarget':
            return {
              key: action,
              label,
              onPress: () => {
                askRetarget(item);
              },
            };
          case 'recreate':
            return {
              key: action,
              label,
              onPress: () => {
                session.openRecreate(item);
              },
              variant: 'primary' as const,
            };
          case 'discard':
            return {
              key: action,
              label,
              onPress: () => {
                askDiscard(item);
              },
              variant: 'dangerTertiary' as const,
            };
        }
      });
    const details = [
      ...(item.code === null ? [] : [t('attention.detailCode', { code: item.code })]),
      t('attention.detailAttempts', { count: item.attempts }),
      t('attention.detailDate', { date: formatDateTime(item.createdAt) }),
    ];
    return (
      <AttentionCard
        key={item.id}
        title={type}
        age={t('attention.age', { date: formatDateTime(item.createdAt) })}
        reason={reason}
        {...(item.dependents > 0
          ? {
              group: t(
                pluralKey(item.dependents, { one: 'attention.group_one', few: 'attention.group_few', many: 'attention.group_many' }),
                { count: item.dependents },
              ),
            }
          : {})}
        body={hidden ? null : item.label}
        detailsLabel={t('attention.details')}
        details={details}
        accessibilityLabel={t('attention.accessibleName', { type, reason })}
        actions={actions}
        extra={hidden ? <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('attention.hiddenActions')}</Text> : undefined}
        testID={`attention-${item.id}`}
      />
    );
  };

  const rowFor = (item: QueueItem) => {
    const type = types[item.type] ?? t('queue.types.other');
    const state = states[item.state] ?? states['pending'] ?? '';
    return (
      <View
        key={item.id}
        accessible
        accessibilityLabel={[type, state, item.label].filter((part): part is string => part !== null).join(', ')}
        style={{
          minHeight: size.touchTarget.min,
          padding: space.inset.sm,
          borderBottomWidth: borderWidth.default,
          borderBottomColor: color.border.subtle,
        }}
        testID="queue-row"
      >
        <Text style={{ ...text.labelLg, color: color.text.primary }}>{type}</Text>
        <Text style={{ ...text.bodySm, color: color.text.secondary }}>{state}</Text>
        {item.label === null ? null : <Text style={{ ...text.body, color: color.text.primary }}>{item.label}</Text>}
      </View>
    );
  };

  const items = view?.items ?? [];
  const attention = items.filter((item) => item.state === 'attention');
  const waiting = items.filter((item) => item.state !== 'attention');
  const sent = view?.sent ?? [];
  const total = items.length;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.queue.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ConnectionNotices />
      <SyncNotices now={now} />
      {notice === null ? null : (
        <View style={{ padding: space.inset.md }}>
          <InlineAlert tone="info" body={notice} testID="queue-notice" />
        </View>
      )}
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {view === null || (total === 0 && sent.length === 0) ? (
          <EmptyState icon={ListChecks} title={t('shell.queue.emptyTitle')} testID="queue-empty" />
        ) : (
          <View style={{ padding: space.inset.md, rowGap: space.stack.md }} testID={hidden ? 'queue-list-hidden' : 'queue-list'}>
            <Text style={{ ...text.heading4, color: color.text.primary }} testID={hidden ? 'queue-hidden-count' : 'queue-count'}>
              {hidden
                ? t(pluralKey(total, { one: 'hidden.queueCount_one', few: 'hidden.queueCount_few', many: 'hidden.queueCount_many' }), {
                    count: total,
                  })
                : t(pluralKey(total, { one: 'queue.count_one', few: 'queue.count_few', many: 'queue.count_many' }), { count: total })}
            </Text>
            {attention.length === 0 ? null : (
              <View style={{ rowGap: space.stack.sm }} testID="queue-attention">
                <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
                  {t('queue.sections.attention')}
                </Text>
                {attention.map(cardFor)}
              </View>
            )}
            {waiting.length === 0 ? null : (
              <View style={{ rowGap: space.stack.xs }} testID="queue-waiting">
                <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
                  {t('queue.sections.waiting')}
                </Text>
                {waiting.map(rowFor)}
              </View>
            )}
            {sent.length === 0 ? null : (
              <View style={{ rowGap: space.stack.xs }} testID="queue-sent">
                <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
                  {t('queue.sections.sent')}
                </Text>
                {sent.map((row) => (
                  <View
                    key={row.id}
                    accessible
                    accessibilityLabel={`${types[row.type] ?? t('queue.types.other')}, ${t('queue.states.sent')}`}
                    style={{
                      minHeight: size.touchTarget.min,
                      padding: space.inset.sm,
                      borderBottomWidth: borderWidth.default,
                      borderBottomColor: color.border.subtle,
                    }}
                    testID="queue-sent-row"
                  >
                    <Text style={{ ...text.labelLg, color: color.text.primary }}>{types[row.type] ?? t('queue.types.other')}</Text>
                    <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('queue.sentAt', { time: formatClock(row.at) })}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      {confirm === null ? null : (
        <AlertDialog
          title={t('attention.discard.title')}
          onCancel={() => {
            setConfirm(null);
          }}
          actions={
            <>
              <Button
                variant="danger"
                label={t('attention.discard.confirm')}
                onPress={() => {
                  const { item } = confirm;
                  setConfirm(null);
                  void session.sync.discard(item.id).then((result) => {
                    if (!result.ok) fail();
                    reload();
                  });
                }}
                testID="discard-confirm"
              />
              <Button
                variant="tertiary"
                label={t('attention.discard.cancel')}
                onPress={() => {
                  setConfirm(null);
                }}
                testID="discard-cancel"
              />
            </>
          }
          testID="discard-dialog"
        >
          <Text style={{ ...text.body, color: color.text.primary }}>
            {confirm.dependents > 0
              ? t(
                  pluralKey(confirm.dependents, {
                    one: 'attention.discard.group_one',
                    few: 'attention.discard.group_few',
                    many: 'attention.discard.group_many',
                  }),
                  { count: confirm.dependents },
                )
              : t('attention.discard.body')}
          </Text>
        </AlertDialog>
      )}
      {targets === null ? null : (
        <AlertDialog
          title={t('attention.retarget.title')}
          onCancel={() => {
            setTargets(null);
          }}
          actions={
            <Button
              variant="tertiary"
              label={t('attention.retarget.cancel')}
              onPress={() => {
                setTargets(null);
              }}
              testID="retarget-cancel"
            />
          }
          testID="retarget-dialog"
        >
          {targets.options.length === 0 ? (
            <Text style={{ ...text.body, color: color.text.primary }}>{t('attention.retarget.empty')}</Text>
          ) : (
            <View style={{ rowGap: space.stack.xs }}>
              {targets.options.slice(0, 20).map((option) => (
                <Button
                  key={option.id}
                  variant="tertiary"
                  label={t('attention.retarget.option', { number: option.number, title: option.title })}
                  onPress={() => {
                    const { item } = targets;
                    setTargets(null);
                    void session.sync.retarget(item.id, option.id).then((result) => {
                      if (!result.ok) fail();
                      reload();
                    });
                  }}
                  testID={`retarget-${option.id}`}
                />
              ))}
            </View>
          )}
        </AlertDialog>
      )}
    </View>
  );
}
