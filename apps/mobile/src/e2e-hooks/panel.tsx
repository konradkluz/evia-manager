/**
 * Hooks of the e2e variant (EVM-093 AC1, AC3, AC5–AC7; ADR-0015) — bundled ONLY when Metro builds the e2e variant
 * (plugins/e2e-hooks-resolver.ts); `tools/mobile-apk verify` fails a package that carries E2E_HOOKS_MARKER.
 * Security K4: a hidden panel reached by `testID` only — no deep link, no exported component, no network listener. It works through
 * the public ports of the store (`openForUser`, `wipeCompanyData`, `facts`, `probe`) and of the secure store; it never imports
 * expo-sqlite, never reads the key, and its status line carries codes and numbers only (no key, no KCV, no path, no content).
 * The labels are fixed codes of a test instrument, not UI text of the app (no i18n on purpose: they never reach a field phone).
 */
import type { QueueRecord } from '@evia/sync-core';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NO_OVERRIDES, type DeviceOverrides } from '../device-guard/overrides';
import { LocalDataLostScreen } from '../screens/LocalDataScreens';
import { loadEviaUpload } from '../../modules/evia-upload/src';
import { sessionMediaUploads, sessionPorts } from '../session';
import type { CaptureRequest, CaptureResult } from '../capture/capture-pipeline';
import { saveSyntheticPicture } from './synthetic-picture';
import { tokenStore } from '../secure-store';
import type { SyncControl } from '../sync/types';
import type { AddMediaResult } from '../upload/media-uploads';
import { MEDIA_CATEGORIES, type NewMediaAsset } from '../upload/create-media-asset';
import type { MediaControl, MediaFileStatus } from '../upload/types';
import { localData, storageE2eSupport, type LocalDataHost, type OpenResult, type UnlockedStore } from '../storage';
import { Button } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';

/** Unique marker of the hooks in a bundle (also the testID of the toggle): tools/mobile-apk/src/contents.mjs E2E_HOOKS_MARKER. */
export const E2E_HOOKS_MARKER = 'evia-e2e-hooks-panel';

/**
 * Answers of the device controls that the scenarios move (EVM-101; security K7): the screen lock, the time without contact with the
 * server and the time in the background. `src/session.ts` reads this object through the slot (`null` in every other bundle).
 *
 * The scenario emulator has no screen lock, and the app refuses to work without one (EVM-101): the e2e variant answers "locked" until a
 * scenario asks for the real answer (`e2e-lock-real`) or for "no lock" (`e2e-lock-off`); the system unlock answers `success` (no credential on the emulator).
 */
export const E2E_DEFAULT_OVERRIDES: DeviceOverrides = { ...NO_OVERRIDES, screenSecure: true, autoUnlock: true };
export const deviceOverrides: DeviceOverrides = { ...E2E_DEFAULT_OVERRIDES };

/** Synthetic users of the scenarios (never real people). */
export const E2E_USERS = { a: 'e2e-user-a', b: 'e2e-user-b' } as const;

/** The synthetic marker that AC1 searches on the emulator, composed at run time so that the bundle never carries it. */
export const sentinel = (): string => ['EVM093', 'SENTINEL'].join('-');

const LABELS = {
  loginA: 'login A',
  loginB: 'login B',
  append: 'append',
  endSession: 'end session',
  wipe: 'wipe',
  deleteKey: 'delete key',
  facts: 'facts',
  probe: 'probe copy',
  close: 'close',
  lockOff: 'screen lock off',
  lockReal: 'screen lock real',
  contact5: 'no contact 5 days',
  contact8: 'no contact 8 days',
  contactBack: 'clock back',
  contactReset: 'contact reset',
  background6: 'background 6 min',
  syncAdd: 'sync: add notes',
  syncStatus: 'sync: status',
  mediaInject: 'media: inject file',
  mediaStatus: 'media: status',
  captureBatch: 'media: capture N',
} as const;

/** EVM-130 (media block): the synthetic file of the scenarios — a work order that never existed, a size in MiB, random content made natively. */
export const E2E_MEDIA_WORK_ORDER = '30000000-0000-4000-8000-000000000001';
export const MIB = 1024 * 1024;
export const E2E_MEDIA_MAX_MIB = 256;
/** EVM-108 AC7: the most shots of one press of `media: capture N` (the story asks for 30). */
export const E2E_CAPTURE_MAX = 60;

export interface E2eHooksDeps {
  readonly host: Pick<LocalDataHost, 'openForUser' | 'wipeCompanyData' | 'facts' | 'probe'>;
  readonly deleteDatabaseKey: () => Promise<void>;
  readonly wipeFault: { afterStep: string | null };
  readonly copyEngine: () => Parameters<LocalDataHost['probe']>[0];
  readonly now: () => number;
  /** The synchronization of the signed-in session (EVM-107 AC6): the real one by default, read when a button is pressed. */
  readonly sync?: () => Pick<SyncControl, 'enqueue' | 'getSnapshot' | 'trigger'>;
  /** EVM-130: the files of the session — adds a file (command + row) and shows the states. */
  readonly media?: () => {
    readonly add: (asset: NewMediaAsset) => Promise<AddMediaResult>;
    readonly view: Pick<MediaControl, 'getSnapshot'>;
    /** The native hook of the e2e package: writes `sizeBytes` of random content as the original of `assetId` (`null` in every other package). */
    readonly inject: (assetId: string, sizeBytes: number, seed: number) => Promise<{ sizeBytes: number; sha256: string } | null>;
    readonly newId: () => string;
  };
  /**
   * EVM-108 AC7: one shot through the capture pipeline of the session (the SAME one the camera screen uses) with a synthetic picture of `seed`
   * written to `cacheDir/Camera/<uuid>.jpg` instead of the picture of `takePictureAsync`; every step after that is the path of a photograph.
   */
  readonly capture?: () => { readonly shoot: (request: CaptureRequest, seed: number) => Promise<CaptureResult> };
}

const realDeps = (): E2eHooksDeps => ({
  host: localData(),
  deleteDatabaseKey: () => tokenStore.delete('databaseKey'),
  wipeFault: storageE2eSupport.wipeFault,
  copyEngine: storageE2eSupport.copyEngine,
  now: Date.now,
  sync: () => sessionPorts().sync,
  media: () => {
    const ports = sessionPorts();
    const uploads = sessionMediaUploads();
    const native = loadEviaUpload();
    return {
      add: (asset) => uploads?.add(asset) ?? Promise.resolve({ ok: false, code: 'no_session' }),
      view: ports.media,
      inject: (assetId, sizeBytes, seed) => native?.e2eInjectFile(assetId, sizeBytes, seed) ?? Promise.resolve(null),
      newId: ports.newId,
    };
  },
  capture: () => {
    const ports = sessionPorts();
    const uploads = sessionMediaUploads();
    let seed = 0;
    const pipeline = uploads?.capturePipeline(() => saveSyntheticPicture(ports.newId(), seed));
    return {
      shoot: (request, next) => {
        seed = next;
        return pipeline?.capture(request) ?? Promise.resolve({ ok: false, code: 'camera_failed' });
      },
    };
  },
});

/** One status line: `key=value` pairs in a fixed order; values are codes and numbers only. */
export type Status = Readonly<Record<string, string | number>>;
export const statusLine = (status: Status): string =>
  Object.entries(status)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(';');

const hex12 = (n: number): string => n.toString(16).padStart(12, '0').slice(-12);

/** A synthetic queue entry of `userId` carrying the sentinel (AC1, AC3). */
export function syntheticRecord(userId: string, n: number): QueueRecord {
  const id = (offset: number) => `0194c2a0-0000-7000-8000-${hex12(n * 2 + offset)}`;
  return {
    mutationId: id(0),
    type: 'CreateNote',
    commandVersion: 1,
    payload: { id: id(1), workOrderId: '10000000-0000-4000-8000-000000000093', body: `${sentinel()} ${String(n)}` },
    objectId: id(1),
    orderingKey: '10000000-0000-4000-8000-000000000093',
    createdAt: n,
    ownerUserId: userId,
    state: 'pending',
    attempts: 0,
  };
}

export function E2eHooks({ deps: injected }: { deps?: E2eHooksDeps } = {}) {
  const deps = useRef<E2eHooksDeps | null>(injected ?? null);
  const get = (): E2eHooksDeps => (deps.current ??= realDeps());
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ open: 'none' });
  const [count, setCount] = useState('1');
  const [fault, setFault] = useState('');
  const [lost, setLost] = useState<Extract<OpenResult, { kind: 'data_lost' }> | null>(null);
  const store = useRef<UnlockedStore | null>(null);

  const report = useCallback(async (result: OpenResult): Promise<void> => {
    store.current = null;
    setLost(null);
    if (result.kind === 'unlocked') {
      store.current = result.store;
      const identity = (await result.store.identity.read()) === null ? 'new' : 'kept';
      if (identity === 'new') {
        const n = get().now();
        await result.store.identity.write({ deviceId: `e2e-device-${String(n)}`, secret: `e2e-secret-${String(n)}` });
      }
      setStatus({
        open: 'unlocked',
        queue: await result.store.unsentItemCount(),
        identity,
        pull: result.initialPullRequired ? 'first' : 'no',
      });
    } else if (result.kind === 'owner_mismatch') {
      setStatus({ open: 'owner_mismatch', queue: result.unsentItemCount });
    } else if (result.kind === 'data_lost') {
      setLost(result);
      setStatus({ open: 'data_lost', reason: result.reason });
    } else if (result.kind === 'unavailable') {
      setStatus({ open: 'unavailable', reason: result.code });
    } else {
      setStatus({ open: result.kind });
    }
  }, []);

  const guarded = (action: () => Promise<void>) => () => {
    setStatus({ busy: 'yes' });
    action().catch(() => {
      setStatus({ error: 'action_failed' });
    });
  };

  const login = (userId: string) => guarded(async () => report(await get().host.openForUser(userId)));

  const append = guarded(async () => {
    const unlocked = store.current;
    if (unlocked === null) {
      setStatus({ error: 'locked' });
      return;
    }
    const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 500);
    const base = get().now();
    for (let i = 0; i < n; i += 1) await unlocked.queue.append(syntheticRecord(unlocked.userId, base + i));
    // shown only after every `append` resolved (AC3: the confirmation comes before the force-stop of scenario 09)
    setStatus({ open: 'unlocked', appended: n, queue: await unlocked.unsentItemCount() });
  });

  const endSession = guarded(async () => {
    await store.current?.endSession();
    store.current = null;
    setStatus({ open: 'locked' });
  });

  const wipe = guarded(async () => {
    get().wipeFault.afterStep = fault.trim() === '' ? null : fault.trim();
    store.current = null;
    setStatus({ wipe: await get().host.wipeCompanyData() });
  });

  const deleteKey = guarded(async () => {
    await get().deleteDatabaseKey();
    setStatus({ key: 'deleted' });
  });

  const facts = guarded(async () => {
    const found = await get().host.facts();
    setStatus({
      open: found.open ? 'yes' : 'no',
      cipher_version: found.cipherVersion ?? 'none',
      temp_store: found.tempStore ?? 'none',
      wipe_pending: found.wipePending === null ? 'unknown' : found.wipePending ? 'yes' : 'no',
      queue: store.current === null ? 'locked' : await store.current.unsentItemCount(),
    });
  });

  /** EVM-107 AC6: N synthetic notes into the durable queue of the signed-in session (in airplane mode they wait for the network). */
  const syncAdd = guarded(async () => {
    const sync = (get().sync ?? realDeps().sync)?.();
    if (sync === undefined) {
      setStatus({ error: 'no_sync' });
      return;
    }
    const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 100);
    const base = get().now();
    let added = 0;
    for (let i = 0; i < n; i += 1) {
      const result = await sync.enqueue({
        type: 'CreateNote',
        commandVersion: 1,
        payload: {
          id: `0194c2a0-0000-7000-8000-${hex12(base * 1000 + i)}`,
          workOrderId: '30000000-0000-4000-8000-000000000001',
          noteCategory: 'meeting',
          body: `e2e note ${String(i + 1)}`,
          capturedAt: new Date(base).toISOString(),
        },
      });
      if (result.ok) added += 1;
    }
    // shown only after every `enqueue` resolved: the notes are in the durable queue (scenario 30 kills the app right after)
    setStatus({ sync_added: added, unsent: sync.getSnapshot().counts.unsent });
  });

  const syncStatus = guarded(async () => {
    const sync = (get().sync ?? realDeps().sync)?.();
    if (sync === undefined) {
      setStatus({ error: 'no_sync' });
      return;
    }
    const snap = sync.getSnapshot();
    setStatus({
      sync: snap.active ? 'active' : 'idle',
      initial: snap.initialLoad,
      unsent: snap.counts.unsent,
      failure: snap.failure ?? 'none',
      last: snap.lastSuccessAt === null ? 'none' : 'yes',
    });
    await Promise.resolve();
  });

  const [mediaMib, setMediaMib] = useState('1');
  /**
   * EVM-130 AC1: a synthetic file in the durable queue without the camera. The native hook writes random content of the given size under
   * the id of a new asset; then the command `CreateMediaAsset` and the row are made like for a photo — the job is armed after `applied`.
   */
  const mediaInject = guarded(async () => {
    const media = (get().media ?? realDeps().media)?.();
    if (media === undefined) {
      setStatus({ error: 'no_media' });
      return;
    }
    const mib = Math.min(Math.max(Number.parseInt(mediaMib, 10) || 1, 1), E2E_MEDIA_MAX_MIB);
    const assetId = media.newId();
    const digest = await media.inject(assetId, mib * MIB, get().now() % 2_000_000_000);
    if (digest === null) {
      setStatus({ error: 'no_media_hook' });
      return;
    }
    const added = await media.add({ assetId, workOrderId: E2E_MEDIA_WORK_ORDER, mediaType: 'photo', category: 'other' });
    // shown only after the command is in the durable queue (a scenario kills the app right after)
    setStatus(added.ok ? { media_added: 1, asset: assetId, bytes: digest.sizeBytes } : { error: added.code });
  });

  const mediaStatus = guarded(async () => {
    const media = (get().media ?? realDeps().media)?.();
    if (media === undefined) {
      setStatus({ error: 'no_media' });
      return;
    }
    const snapshot = media.view.getSnapshot();
    const count = (status: MediaFileStatus): number => snapshot.files.filter((file) => file.status === status).length;
    setStatus({
      files: snapshot.files.length,
      waiting: count('waiting'),
      uploading: count('uploading'),
      sent: count('sent'),
      failed: count('error'),
      attention: count('attention'),
      notifications: snapshot.notifications,
    });
    await Promise.resolve();
  });

  const [captureCount, setCaptureCount] = useState('1');
  /**
   * EVM-108 AC7: N shots through the capture pipeline of the camera (one after another, categories in turn), each with its own synthetic
   * picture (a different SHA-256). The status line confirms only after the LAST durable save: from then on the app may be killed.
   */
  const captureBatch = guarded(async () => {
    const capture = (get().capture ?? realDeps().capture)?.();
    if (capture === undefined) {
      setStatus({ error: 'no_capture' });
      return;
    }
    const n = Math.min(Math.max(Number.parseInt(captureCount, 10) || 1, 1), E2E_CAPTURE_MAX);
    const base = get().now();
    let added = 0;
    for (let i = 0; i < n; i += 1) {
      const category = MEDIA_CATEGORIES[i % MEDIA_CATEGORIES.length] ?? 'other';
      const result = await capture.shoot({ workOrderId: E2E_MEDIA_WORK_ORDER, category }, base + i);
      if (!result.ok) {
        setStatus({ capture_added: added, error: result.code });
        return;
      }
      added += 1;
    }
    setStatus({ capture_added: added });
  });

  const device = (name: string, change: (o: DeviceOverrides) => void) => () => {
    change(deviceOverrides);
    setStatus({ device: name });
  };

  const probe = guarded(async () => {
    setStatus({ probe: await get().host.probe(get().copyEngine()) });
  });

  if (lost !== null)
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <LocalDataLostScreen
          onAcknowledge={guarded(async () => {
            await report(await lost.acknowledge());
          })}
        />
        <Text testID="e2e-status" style={{ ...text.body, color: color.text.secondary, padding: space.inset.sm }}>
          {statusLine(status)}
        </Text>
      </View>
    );

  if (!open)
    return (
      <Pressable
        testID={E2E_HOOKS_MARKER}
        accessibilityLabel={E2E_HOOKS_MARKER}
        onPress={() => {
          setOpen(true);
        }}
        style={{ position: 'absolute', top: insets.top, left: 0, minWidth: size.touchTarget.min, minHeight: size.touchTarget.min }}
      />
    );

  const input = {
    ...text.body,
    color: color.text.primary,
    borderWidth: borderWidth.default,
    borderColor: color.border.default,
    padding: space.inset.sm,
  };
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.bg.canvas, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: space.inset.md, gap: space.stack.sm }}>
        <Text testID="e2e-status" style={{ ...text.body, color: color.text.primary }}>
          {statusLine(status)}
        </Text>
        <Button label={LABELS.loginA} onPress={login(E2E_USERS.a)} testID="e2e-login-a" />
        <Button label={LABELS.loginB} onPress={login(E2E_USERS.b)} testID="e2e-login-b" />
        <TextInput testID="e2e-count" value={count} onChangeText={setCount} keyboardType="number-pad" style={input} />
        <Button label={LABELS.append} onPress={append} testID="e2e-append" />
        <Button label={LABELS.endSession} onPress={endSession} testID="e2e-end-session" />
        <TextInput testID="e2e-wipe-fault" value={fault} onChangeText={setFault} autoCapitalize="none" style={input} />
        <Button label={LABELS.wipe} onPress={wipe} testID="e2e-wipe" />
        <Button label={LABELS.deleteKey} onPress={deleteKey} testID="e2e-delete-key" />
        <Button label={LABELS.facts} onPress={facts} testID="e2e-facts" />
        <Button label={LABELS.probe} onPress={probe} testID="e2e-probe" />
        <Button label={LABELS.syncAdd} onPress={syncAdd} testID="e2e-sync-add" />
        <Button label={LABELS.syncStatus} onPress={syncStatus} testID="e2e-sync-status" />
        {/* EVM-130 (media block) */}
        <TextInput testID="e2e-media-mib" value={mediaMib} onChangeText={setMediaMib} keyboardType="number-pad" style={input} />
        <Button label={LABELS.mediaInject} onPress={mediaInject} testID="e2e-media-inject" />
        <Button label={LABELS.mediaStatus} onPress={mediaStatus} testID="e2e-media-status" />
        <TextInput testID="e2e-capture-count" value={captureCount} onChangeText={setCaptureCount} keyboardType="number-pad" style={input} />
        <Button label={LABELS.captureBatch} onPress={captureBatch} testID="e2e-capture-batch" />
        <Button
          label={LABELS.lockOff}
          onPress={device('lock_off', (o) => {
            o.screenSecure = false;
          })}
          testID="e2e-lock-off"
        />
        <Button
          label={LABELS.lockReal}
          onPress={device('lock_real', (o) => {
            o.screenSecure = null;
          })}
          testID="e2e-lock-real"
        />
        <Button
          label={LABELS.contact5}
          onPress={device('contact_5d', (o) => {
            o.contactShiftMs = 5 * 86_400_000;
          })}
          testID="e2e-contact-5"
        />
        <Button
          label={LABELS.contact8}
          onPress={device('contact_8d', (o) => {
            o.contactShiftMs = 8 * 86_400_000;
          })}
          testID="e2e-contact-8"
        />
        <Button
          label={LABELS.contactBack}
          onPress={device('clock_back', (o) => {
            o.contactShiftMs = -86_400_000;
          })}
          testID="e2e-clock-back"
        />
        <Button
          label={LABELS.contactReset}
          onPress={device('contact_reset', (o) => {
            o.contactShiftMs = 0;
          })}
          testID="e2e-contact-reset"
        />
        <Button
          label={LABELS.background6}
          onPress={device('background_6m', (o) => {
            o.backgroundShiftMs = 6 * 60_000;
          })}
          testID="e2e-background-6"
        />
        <Button
          label={LABELS.close}
          onPress={() => {
            setOpen(false);
          }}
          variant="tertiary"
          testID="e2e-close"
        />
      </ScrollView>
    </View>
  );
}
