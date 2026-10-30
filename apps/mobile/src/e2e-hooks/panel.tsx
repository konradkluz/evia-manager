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
import { LocalDataLostScreen } from '../screens/LocalDataScreens';
import { tokenStore } from '../secure-store';
import { localData, storageE2eSupport, type LocalDataHost, type OpenResult, type UnlockedStore } from '../storage';
import { Button } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';

/** Unique marker of the hooks in a bundle (also the testID of the toggle): tools/mobile-apk/src/contents.mjs E2E_HOOKS_MARKER. */
export const E2E_HOOKS_MARKER = 'evia-e2e-hooks-panel';

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
} as const;

export interface E2eHooksDeps {
  readonly host: Pick<LocalDataHost, 'openForUser' | 'wipeCompanyData' | 'facts' | 'probe'>;
  readonly deleteDatabaseKey: () => Promise<void>;
  readonly wipeFault: { afterStep: string | null };
  readonly copyEngine: () => Parameters<LocalDataHost['probe']>[0];
  readonly now: () => number;
}

const realDeps = (): E2eHooksDeps => ({
  host: localData(),
  deleteDatabaseKey: () => tokenStore.delete('databaseKey'),
  wipeFault: storageE2eSupport.wipeFault,
  copyEngine: storageE2eSupport.copyEngine,
  now: Date.now,
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
      queue: store.current === null ? 'locked' : await store.current.unsentItemCount(),
    });
  });

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
