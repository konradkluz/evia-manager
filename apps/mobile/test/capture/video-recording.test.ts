// EVM-110 AC2, AC3: the recording on its own (a source that throws, readings that are not numbers) and the marker of a recording that outlives the process.
import { VideoRecording, type VideoSource } from '../../src/capture/video-recording';
import { createRecordingMarker, recordingMarker } from '../../src/storage/recording-marker';

jest.mock('../../src/storage/platform', () => {
  const files = new Map<string, string>();
  return {
    createAppFiles: () => ({
      read: (name: string) => Promise.resolve(files.get(name) ?? null),
      write: (name: string, text: string) => {
        files.set(name, text);
        return Promise.resolve();
      },
      remove: (name: string) => {
        files.delete(name);
        return Promise.resolve();
      },
    }),
  };
});

const MB = 1024 * 1024;

const recording = (
  source: VideoSource,
  save = jest.fn(() => Promise.resolve({ ok: false, code: 'save_failed' } as const)),
  now = () => 1000,
) => new VideoRecording({ source, disk: { freeBytes: () => 10 * 1024 * MB }, now, maxFileSize: 500_000_000, save });

describe('the recording on its own (EVM-110 AC2, AC3)', () => {
  it('EVM-110 AC3: a source that throws at once is a failure of the camera - nothing is saved and `recorded` still resolves', async () => {
    const save = jest.fn(() => Promise.resolve({ ok: false, code: 'save_failed' } as const));
    const failing = recording(
      {
        record: () => {
          throw new Error('synthetic');
        },
        stop: () => undefined,
      },
      save,
    );
    expect(await failing.done).toEqual({ ok: false, code: 'camera_failed', reason: 'record_rejected' });
    await failing.recorded;
    expect(save).not.toHaveBeenCalled();
  });

  it('EVM-110 AC3: a stop that throws does not break the recording - the save still runs when the library resolves', async () => {
    let finish: (value: { uri: string }) => void = () => undefined;
    const save = jest.fn(() => Promise.resolve({ ok: false, code: 'save_failed' } as const));
    const running = recording(
      {
        record: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        stop: () => {
          throw new Error('the view is gone');
        },
      },
      save,
    );
    expect(() => {
      running.stop('interrupted');
    }).not.toThrow();
    finish({ uri: 'file:///cache/Camera/x.mp4' });
    await running.done;
    expect(save).toHaveBeenCalledWith('file:///cache/Camera/x.mp4', 'interrupted', 0, 1000);
  });

  it('EVM-110 AC2: readings that are not numbers are ignored; the length falls back to the wall time when no event ever came', async () => {
    let finish: (value: { uri: string }) => void = () => undefined;
    let clock = 1000;
    const save = jest.fn(() => Promise.resolve({ ok: false, code: 'save_failed' } as const));
    const running = recording(
      {
        record: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        stop: () => undefined,
      },
      save,
      () => clock,
    );
    running.progress({ duration: Number.NaN, fileSize: Number.NaN });
    running.progress({ duration: -3, fileSize: -1 });
    expect(running.seconds).toBe(0);
    clock = 8500;
    expect(running.durationMs()).toBe(7500);
    finish({ uri: 'file:///cache/Camera/x.mp4' });
    await running.done;
    expect(save).toHaveBeenCalledWith('file:///cache/Camera/x.mp4', 'stopped', 7500, 1000);
  });
});

describe('the marker of a recording (EVM-110 AC3)', () => {
  it('EVM-110 AC3: set, present and clear on the files of the app - one character and nothing else', async () => {
    const written: string[] = [];
    const store = new Map<string, string>();
    const marker = createRecordingMarker({
      read: (name) => Promise.resolve(store.get(name) ?? null),
      write: (name, text) => {
        written.push(text);
        store.set(name, text);
        return Promise.resolve();
      },
      remove: (name) => {
        store.delete(name);
        return Promise.resolve();
      },
    });
    expect(await marker.present()).toBe(false);
    await marker.set();
    expect(await marker.present()).toBe(true);
    expect(written).toEqual(['1']);
    await marker.clear();
    expect(await marker.present()).toBe(false);
  });

  it('EVM-110 AC3: the marker of the process works on the real files, created at the first use', async () => {
    expect(await recordingMarker.present()).toBe(false);
    await recordingMarker.set();
    expect(await recordingMarker.present()).toBe(true);
    await recordingMarker.clear();
    expect(await recordingMarker.present()).toBe(false);
  });
});
