// EVM-011 SPIKE: technical screen (no styleguide, English labels on purpose; out of scope of the story).
// Flow: camera -> app-private sandbox -> SHA-256 (native, streaming) -> row in the encrypted DB -> native job file -> UIDT job.
// "Saved" is shown only after the file is durable, the DB row is committed and the job is registered.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getRandomBytes } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { uuidv7 } from '@evm011/core/portable';
import Native, { type LaunchCommand, type NativeJob } from '../modules/spike-uploader/src';
import { openQueueDb } from './db';

type Kind = 'photo' | 'video' | 'synthetic';

export default function App() {
  const db = useRef<SQLiteDatabase | null>(null);
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [jobs, setJobs] = useState<NativeJob[]>([]);
  const [notice, setNotice] = useState('starting');
  const [freeMb, setFreeMb] = useState(0);

  const ingest = useCallback(async (path: string, kind: Kind, contentType: string, flag?: string) => {
    const sha = await Native.sha256File(path);
    const assetId = uuidv7(Date.now(), getRandomBytes(10));
    // The native job file is written first (atomic, fsync); the DB row follows. A kill in between is repaired at start-up.
    const size = await Native.registerJob(assetId, path, sha, contentType, flag === 'kill_after_complete');
    await db.current!.runAsync(
      'INSERT OR IGNORE INTO media (asset_id, kind, path, size, sha256, content_type, created_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [assetId, kind, path, size, sha, contentType, Date.now(), 'pending'],
    );
    const result = await Native.scheduleUpload(assetId);
    setNotice(`saved ${assetId.slice(0, 8)} (${result})`);
  }, []);

  const handleCommand = useCallback(
    async (c: LaunchCommand | null) => {
      if (!c || !db.current) return;
      if (c.cmd === 'enqueue' && c.path) {
        await ingest(c.path, 'synthetic', c.type === 'image/jpeg' ? 'image/jpeg' : 'video/mp4', c.flag);
      } else if (c.cmd === 'reschedule') {
        setNotice(`rescheduled ${await Native.ensureScheduled()}`);
      } else if (c.cmd === 'confirm' && c.asset && c.sha) {
        setNotice(`confirm ${c.asset.slice(0, 8)} -> ${await Native.confirmAndDelete(c.asset, c.sha)}`);
      }
    },
    [ingest],
  );

  // Start-up: open the encrypted DB, re-create jobs lost to a force-stop, re-register rows whose job file is missing.
  useEffect(() => {
    void (async () => {
      db.current = await openQueueDb();
      const known = new Set((await Native.getJobs()).map((j) => j.assetId));
      const rows = await db.current.getAllAsync<{ asset_id: string; path: string; sha256: string; content_type: string }>(
        "SELECT asset_id, path, sha256, content_type FROM media WHERE state = 'pending'",
      );
      for (const r of rows) if (!known.has(r.asset_id)) await Native.registerJob(r.asset_id, r.path, r.sha256, r.content_type, false);
      const n = await Native.ensureScheduled();
      setFreeMb(Math.round((await Native.freeBytes()) / (1024 * 1024)));
      setNotice(`ready (rescheduled ${n})`);
      await handleCommand(Native.getLaunchCommand());
    })();
    const sub = Native.addListener('onCommand', (c) => void handleCommand(c));
    return () => sub.remove();
  }, [handleCommand]);

  // Poll the native job files (JS reconciles state into the DB; it is the only writer of the DB).
  useEffect(() => {
    const t = setInterval(() => {
      void (async () => {
        const list = await Native.getJobs();
        setJobs(list);
        if (!db.current) return;
        for (const j of list) {
          await db.current.runAsync('UPDATE media SET state = ? WHERE asset_id = ? AND state != ?', [j.state, j.assetId, j.state]);
        }
      })();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const capture = async (kind: 'photo' | 'video') => {
    if (!camera.current) return;
    try {
      if (kind === 'photo') {
        const pic = await camera.current.takePictureAsync({ quality: 0.6, exif: false, skipProcessing: true });
        const moved = await Native.moveToSandbox(pic.uri);
        await ingest(moved.path, 'photo', 'image/jpeg');
      } else if (!recording) {
        setRecording(true);
        const video = await camera.current.recordAsync({ maxDuration: 60 });
        setRecording(false);
        if (video) {
          const moved = await Native.moveToSandbox(video.uri);
          await ingest(moved.path, 'video', 'video/mp4');
        }
      } else {
        camera.current.stopRecording();
      }
    } catch (e) {
      setRecording(false);
      setNotice(`capture error ${(e as Error).name}`);
    }
  };

  const total = jobs.length;
  const uploaded = jobs.filter((j) => j.state === 'uploaded').length;
  const retries = jobs.reduce((s, j) => s + j.retries, 0);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>EVM-011 SPIKE (Android, throwaway)</Text>
      <Text testID="notice">{notice}</Text>
      <Text testID="summary">{`items=${total} uploaded=${uploaded} retries=${retries} freeMB=${freeMb} config=${Native.hasConfig()}`}</Text>
      <View style={styles.row}>
        <Btn
          id="btn-permissions"
          label="Permissions"
          onPress={() => {
            void requestPermission();
            if (Platform.OS === 'android' && Number(Platform.Version) >= 33)
              void PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
          }}
        />
        <Btn id="btn-camera" label={cameraOpen ? 'Close camera' : 'Open camera'} onPress={() => setCameraOpen((v) => !v)} />
        <Btn
          id="btn-reschedule"
          label="Reschedule"
          onPress={() => void Native.ensureScheduled().then((n) => setNotice(`rescheduled ${n}`))}
        />
      </View>
      {cameraOpen && permission?.granted ? (
        <View>
          <CameraView ref={camera} style={styles.camera} mode="video" mute facing="back" />
          <View style={styles.row}>
            <Btn id="btn-photo" label="Photo" onPress={() => void capture('photo')} />
            <Btn id="btn-video" label={recording ? 'Stop video' : 'Record video'} onPress={() => void capture('video')} />
          </View>
        </View>
      ) : null}
      <ScrollView testID="queue">
        {jobs.map((j) => (
          <Text key={j.assetId} style={styles.item}>
            {`${j.assetId.slice(0, 8)} ${j.state} ${Math.round((100 * j.bytesDone) / Math.max(1, j.size))}% parts ${j.partsDone}/${j.partCount} retries ${j.retries} stops ${j.stops}`}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Btn({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  return (
    <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={styles.btn}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12, paddingTop: 40, backgroundColor: '#fff' },
  title: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  btn: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#1d4ed8', borderRadius: 6 },
  btnText: { color: '#fff', fontWeight: '600' },
  camera: { height: 220 },
  item: { fontFamily: 'monospace', fontSize: 12, marginVertical: 2 },
});
