import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, FlatList, Text, View } from 'react-native';
import type { JournalItem, OrderDetail } from '../orders/order-detail-model';
import { AppBar, BackButton, BottomBar, Button, Clock, EmptyState, Inbox, InlineAlert, Skeleton, StatusBadge, ThumbsDown } from '../ui';
import { color, space, text } from '../ui/theme';
import { ConnectionNotices } from './ConnectionNotices';
import { HiddenDataNotice } from './DeviceNotices';
import { OrderFilesRow } from './OrderFilesRow';
import { OrderPhotosRow } from './OrderPhotosRow';
import { OrderStatusBadge } from './OrderCard';
import {
  CustomerCard,
  JournalEntry,
  LocationCard,
  ProcessesSection,
  ScopeSection,
  SectionHeading,
  SurveyHeader,
  SurveyNoCustomer,
  SurveyPhoneCard,
} from './OrderDetailSections';
import { SyncCapsule } from './SyncCapsule';
import { useOrderDetail } from './order-detail-hooks';
import { useSession } from './session-context';

function DetailHeader({ detail }: { detail: OrderDetail }) {
  const { t } = useTranslation();
  const waiting = detail.awaitingNumber === true;
  // EVM-137 (M-03 "wizja"): the mark, the term, the address, the phone of the requester, "Brak klienta" - no client, scope or processes
  if (detail.survey !== undefined && detail.survey !== null) {
    return (
      <View style={{ rowGap: space.stack.sm }}>
        {waiting ? (
          <StatusBadge icon={Clock} label={t('shell.orders.awaitingNumber')} tone={color.sync.queued} testID="order-detail-awaiting" />
        ) : (
          <OrderStatusBadge status={detail.status} testID="order-detail-status" />
        )}
        {detail.status === 'cancelled' ? (
          <StatusBadge
            icon={ThumbsDown}
            label={t('shell.orders.surveyRejected')}
            tone={color.status.order.cancelled}
            testID="order-detail-survey-rejected"
          />
        ) : null}
        <SurveyHeader survey={detail.survey} rejected={detail.status === 'cancelled'} />
        {detail.status === 'cancelled' ? (
          <InlineAlert tone="info" body={t('orderDetail.surveyRejectedInfo')} testID="order-detail-survey-rejected-info" />
        ) : null}
        {waiting ? <InlineAlert tone="info" body={t('orderDetail.surveyPendingBanner')} testID="order-detail-pending-banner" /> : null}
        <LocationCard location={detail.location} />
        <SurveyPhoneCard survey={detail.survey} />
        <SurveyNoCustomer />
      </View>
    );
  }
  return (
    <View style={{ rowGap: space.stack.sm }}>
      <View style={{ rowGap: space.stack.xs }} accessible accessibilityRole="header" testID="order-detail-header">
        <Text style={{ ...text.heading3, color: color.text.primary }}>{detail.title}</Text>
      </View>
      {waiting ? (
        <>
          <StatusBadge icon={Clock} label={t('shell.orders.awaitingNumber')} tone={color.sync.queued} testID="order-detail-awaiting" />
          <InlineAlert tone="info" body={t('orderDetail.pendingBanner')} testID="order-detail-pending-banner" />
        </>
      ) : (
        <OrderStatusBadge status={detail.status} testID="order-detail-status" />
      )}
      <CustomerCard customer={detail.customer} />
      <LocationCard location={detail.location} />
      {waiting ? (
        <>
          {detail.templateName === null || detail.templateName === undefined ? null : (
            <View accessible accessibilityLabel={`${t('orderDetail.template')}: ${detail.templateName}`} testID="order-detail-template">
              <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('orderDetail.template')}</Text>
              <Text style={{ ...text.body, color: color.text.primary }}>{detail.templateName}</Text>
            </View>
          )}
          {detail.note === null || detail.note === undefined ? null : (
            <View accessible accessibilityLabel={`${t('orderDetail.note')}: ${detail.note}`} testID="order-detail-note">
              <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('orderDetail.note')}</Text>
              <Text style={{ ...text.body, color: color.text.primary }}>{detail.note}</Text>
            </View>
          )}
        </>
      ) : (
        <>
          <ScopeSection scope={detail.scope} />
          <ProcessesSection processes={detail.processes} />
        </>
      )}
    </View>
  );
}

/**
 * The order is not on the phone any more (outside the scope, deleted). For a site survey (EVM-137 AC6; the queue, the replica and the marks
 * know it was one) the message leads to the Queue: the unsent photos and entries of the survey wait there ("Wymaga uwagi", "Usuń z telefonu").
 */
function UnavailableOrder({ orderId, onBack, onOpenQueue }: { orderId: string; onBack: () => void; onOpenQueue: () => void }) {
  const { t } = useTranslation();
  const { sync } = useSession();
  const [survey, setSurvey] = useState(false);
  useEffect(() => {
    let active = true;
    sync.isSurvey(orderId).then(
      (is) => {
        if (active) setSurvey(is);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [sync, orderId]);
  if (survey) {
    return (
      <EmptyState
        icon={Inbox}
        title={t('orderDetail.surveyGone')}
        testID="order-detail-survey-gone"
        action={
          <View style={{ rowGap: space.stack.sm }}>
            <Button label={t('orderDetail.surveyGoneQueue')} onPress={onOpenQueue} testID="order-detail-survey-gone-queue" />
            <Button label={t('orderDetail.backToList')} variant="tertiary" onPress={onBack} testID="order-detail-unavailable-back" />
          </View>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Inbox}
      title={t('orderDetail.unavailableBody')}
      testID="order-detail-unavailable"
      action={<Button label={t('orderDetail.backToList')} onPress={onBack} testID="order-detail-unavailable-back" />}
    />
  );
}

/**
 * "Zlecenie dostało numer ZL-…" (EVM-106 AC4): one polite announcement when the order that was open without a number is given one
 * (the same screen switches from the variant of the queue to the synchronized one). A fixed sentence with the number only - no name,
 * address or title; no dialog and no change of the focus.
 */
function useNumberAnnouncement(detail: OrderDetail | null): void {
  const { t } = useTranslation();
  const waitedFor = useRef<string | null>(null);
  const waitedSurvey = useRef(false);
  const number = detail?.number ?? null;
  const id = detail?.id ?? null;
  useEffect(() => {
    if (detail === null) return;
    if (detail.awaitingNumber === true) {
      waitedFor.current = detail.id;
      waitedSurvey.current = detail.survey !== undefined && detail.survey !== null;
    } else if (number !== null && waitedFor.current === id) {
      waitedFor.current = null;
      AccessibilityInfo.announceForAccessibility(t(waitedSurvey.current ? 'siteSurvey.numberGiven' : 'quickOrder.numberGiven', { number }));
    }
  }, [detail, id, number, t]);
}

/**
 * M-03 "Szczegóły zlecenia", the phone version (EVM-104 AC1-AC6): read only, built from the local replica and the queue - never
 * from the server. The only datum in the navigation is the id of the order (held in the state of the shell, never stored).
 * - Hidden-data mode and sign-out: the hook returns `hidden` in the same render and nothing personal is rendered (AC6).
 * - The fixed bottom bar (EVM-108 AC5): "Zrób zdjęcie" (the main action; `session.openCamera(orderId)`, which refuses an order that is not on the
 *   phone) and "Dodaj wpis" (EVM-105; opens the entry form of this order, the shell holds the id only). The bar is shown while the details are
 *   ready and in the hidden-data mode too (the order is known from the navigation): there the camera works, "Dodaj wpis" is disabled with its reason
 *   and NO number is drawn. Not shown while loading, on an error, when the order is unavailable and while the data are being wiped.
 * - The row "Zdjęcia zlecenia" (EVM-142) sits right above it and opens the photos of the order (from the server, online); same rules: gone with the hidden data.
 * - The row "Pliki z tego telefonu" (EVM-111) sits in the content above the journal and opens "Pliki zlecenia"; it is part of the details, so the hidden-data
 *   mode, the lock of the app and a lost order take it away with the rest.
 * - Unavailable (outside the scope, deleted; also while the screen is open): the fixed message and "Wróć do listy"; the queue items
 *   of the order stay where they are (AC5).
 */
export function OrderDetailScreen({
  orderId,
  onBack,
  onOpenQueue,
  onAddEntry,
  onOpenFiles,
  onOpenPhotos,
}: {
  orderId: string;
  onBack: () => void;
  onOpenQueue: () => void;
  onAddEntry: () => void;
  /** EVM-111: opens "Pliki zlecenia" of this order (the shell hosts the screen; the id is the only datum). */
  onOpenFiles: () => void;
  /** EVM-142: opens "Zdjęcia zlecenia" of this order (the shell hosts the screen; the id is the only datum). */
  onOpenPhotos: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const { state, retry } = useOrderDetail(orderId);
  useNumberAnnouncement(state.kind === 'ready' ? state.detail : null);
  // the camera refused the order (it left the phone in the meantime): said in the bar, nothing opens
  const [cameraRefused, setCameraRefused] = useState(false);
  const takePhoto = (): void => {
    void session.openCamera(orderId).then(
      (opened) => {
        setCameraRefused(!opened);
      },
      () => {
        setCameraRefused(true);
      },
    );
  };
  const hiddenData = state.kind === 'hidden';
  const showBar = state.kind === 'ready' || (state.kind === 'hidden' && state.reason !== 'wipe_in_progress');

  const content = () => {
    switch (state.kind) {
      case 'hidden':
        return (
          <HiddenDataNotice
            reason={state.reason}
            queueCount={null}
            onAction={() => {
              if (state.reason === 'screen_lock_off') void session.recheckDevice();
              else void session.reSignIn();
            }}
          />
        );
      case 'loading':
        return <Skeleton accessibilityLabel={t('shell.loading.label')} testID="order-detail-skeleton" />;
      case 'error':
        return (
          <EmptyState
            icon={Inbox}
            title={t('orderDetail.loadFailed')}
            testID="order-detail-error"
            action={<Button label={t('shell.retry')} onPress={retry} testID="order-detail-retry" />}
          />
        );
      case 'unavailable':
        return <UnavailableOrder orderId={orderId} onBack={onBack} onOpenQueue={onOpenQueue} />;
      case 'ready':
        return (
          <FlatList<JournalItem>
            data={state.detail.journal}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <JournalEntry item={item} onOpenQueue={onOpenQueue} />}
            ItemSeparatorComponent={() => <View style={{ height: space.stack.sm }} />}
            ListHeaderComponent={
              <View style={{ rowGap: space.stack.sm, paddingBottom: space.stack.sm }}>
                <DetailHeader detail={state.detail} />
                {/* EVM-142: the photos of the order from the server (online, in memory only), right above the files of this phone; not drawn while the data are hidden */}
                <OrderPhotosRow orderId={orderId} onOpen={onOpenPhotos} />
                {/* EVM-111 AC1: a fixed row above the journal - the files of THIS phone that have not reached the office (not drawn while the data are hidden) */}
                <OrderFilesRow orderId={orderId} onOpen={onOpenFiles} />
                <SectionHeading title={t('orderDetail.journal')} testID="order-detail-journal-heading" />
              </View>
            }
            ListEmptyComponent={
              <Text style={{ ...text.body, color: color.text.secondary }} testID="order-detail-journal-empty">
                {t('orderDetail.journalEmpty')}
              </Text>
            }
            initialNumToRender={10}
            windowSize={7}
            contentContainerStyle={{ padding: space.inset.md }}
            testID="order-detail-list"
          />
        );
    }
  };

  const title = state.kind === 'ready' ? (state.detail.number ?? t('orderDetail.titleFallback')) : t('orderDetail.titleFallback');
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="order-detail">
      <AppBar
        title={title}
        left={<BackButton accessibilityLabel={t('orderDetail.backA11y')} onPress={onBack} testID="order-detail-back" />}
        right={<SyncCapsule onPress={onOpenQueue} />}
      />
      <ConnectionNotices />
      <View style={{ flex: 1 }}>{content()}</View>
      {showBar ? (
        <BottomBar>
          {cameraRefused ? <InlineAlert tone="error" body={t('orderDetail.unavailableBody')} testID="order-detail-camera-refused" /> : null}
          <Button label={t('orderDetail.takePhoto')} buttonSize="lg" fullWidth onPress={takePhoto} testID="order-detail-take-photo" />
          {hiddenData ? (
            <Text style={{ ...text.bodySm, color: color.text.secondary }} testID="order-detail-add-entry-reason">
              {t('add.hiddenReason')}
            </Text>
          ) : null}
          <Button
            label={t('orderDetail.addEntry')}
            variant="tertiary"
            fullWidth
            disabled={hiddenData}
            {...(hiddenData ? { accessibilityLabel: t('orderDetail.addEntryHidden') } : {})}
            onPress={onAddEntry}
            testID="order-detail-add-entry"
          />
        </BottomBar>
      ) : null}
    </View>
  );
}
