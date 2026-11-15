// A stand-in for `expo-camera` (EVM-108): the view records its props and answers `takePictureAsync` from the test; the permission hook is steered by
// the test. Every OTHER surface of the library (the microphone, the scanners, the direct permission calls) is a spy that fails the test when touched:
// the app asks for the camera through `useCameraPermissions` only (AC3) and never for the microphone.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { View } from 'react-native';

export interface Answer {
  readonly status: 'granted' | 'denied' | 'undetermined';
  readonly canAskAgain: boolean;
  readonly granted: boolean;
}
export const GRANTED: Answer = { status: 'granted', canAskAgain: true, granted: true };
export const UNDETERMINED: Answer = { status: 'undetermined', canAskAgain: true, granted: false };
export const DENIED: Answer = { status: 'denied', canAskAgain: true, granted: false };
export const BLOCKED: Answer = { status: 'denied', canAskAgain: false, granted: false };

/** The widest type of the answer: the first reading may be missing (`null`). */
const initialAnswer = (): Answer | null => GRANTED;
const listeners = new Set<() => void>();
const forbidden = jest.fn<unknown, [string]>();

export const cameraMock = {
  /** What the system answers now (`null` = the first reading is not there yet). */
  permission: initialAnswer(),
  /** What the system prompt answers when the app asks. */
  promptResult: GRANTED,
  prompts: 0,
  reads: 0,
  readyOnMount: true,
  mountError: false,
  mounts: 0,
  props: null as Record<string, unknown> | null,
  takePictureAsync: jest.fn<Promise<{ uri: string }>, [unknown?]>(() => Promise.resolve({ uri: 'file:///cache/Camera/synthetic.jpg' })),
  forbidden,
  /** EVM-110: the recording. `recordAsync` hands the test the way to end it (at a limit, at `stopRecording`, with the file or with a failure). */
  recordOptions: [] as unknown[],
  stopCalls: 0,
  /** When `false` the library does not end the recording by itself on `stopRecording` (the test ends it). */
  endsOnStop: true,
  recordings: [] as { resolve: (value: { uri: string }) => void; reject: (error: Error) => void }[],
  /** Ends the running recording with a file (as the library does at `stopRecording` or at a limit). */
  finishRecording(uri = 'file:///cache/Camera/3f2b9c1e-5d4a-4e8f-9a7b-1c2d3e4f5a6b.mp4'): void {
    cameraMock.recordings.at(-1)?.resolve({ uri });
  },
  /** The view's `onRecordingProgress`. */
  progress(duration: number, fileSize = 1000): void {
    (cameraMock.props?.['onRecordingProgress'] as ((event: { duration: number; fileSize: number }) => void) | undefined)?.({
      duration,
      fileSize,
    });
  },
  set(answer: Answer | null): void {
    cameraMock.permission = answer;
    for (const listener of [...listeners]) listener();
  },
  reset(): void {
    cameraMock.permission = GRANTED;
    cameraMock.promptResult = GRANTED;
    cameraMock.prompts = 0;
    cameraMock.reads = 0;
    cameraMock.readyOnMount = true;
    cameraMock.mountError = false;
    cameraMock.mounts = 0;
    cameraMock.props = null;
    cameraMock.recordOptions = [];
    cameraMock.stopCalls = 0;
    cameraMock.endsOnStop = true;
    cameraMock.recordings = [];
    cameraMock.takePictureAsync.mockReset();
    cameraMock.takePictureAsync.mockResolvedValue({ uri: 'file:///cache/Camera/synthetic.jpg' });
    forbidden.mockReset();
  },
};

interface ViewProps {
  readonly onCameraReady?: () => void;
  readonly onMountError?: (event: { message: string }) => void;
}

export const CameraView = forwardRef<
  {
    takePictureAsync: (options?: unknown) => Promise<{ uri: string }>;
    recordAsync: (options?: unknown) => Promise<{ uri: string }>;
    stopRecording: () => void;
  },
  ViewProps
>(function CameraView(props, ref) {
  cameraMock.props = { ...props };
  useImperativeHandle(
    ref,
    () => ({
      takePictureAsync: (options) => cameraMock.takePictureAsync(options),
      recordAsync: (options) => {
        cameraMock.recordOptions.push(options);
        return new Promise((resolve, reject) => {
          cameraMock.recordings.push({ resolve, reject });
        });
      },
      stopRecording: () => {
        cameraMock.stopCalls += 1;
        if (cameraMock.endsOnStop) cameraMock.finishRecording();
      },
    }),
    [],
  );
  const { onCameraReady, onMountError } = props;
  useEffect(() => {
    cameraMock.mounts += 1;
    if (cameraMock.mountError) onMountError?.({ message: 'synthetic' });
    else if (cameraMock.readyOnMount) onCameraReady?.();
    // the mount only: the real view reports once per start
  }, []);
  return <View testID="camera-view" />;
});

export function useCameraPermissions(): [Answer | null, () => Promise<Answer>, () => Promise<Answer>] {
  const [answer, setAnswer] = useState<Answer | null>(cameraMock.permission);
  useEffect(() => {
    const listener = (): void => {
      setAnswer(cameraMock.permission);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const request = useCallback(() => {
    cameraMock.prompts += 1;
    cameraMock.set(cameraMock.promptResult);
    return Promise.resolve(cameraMock.promptResult);
  }, []);
  const get = useCallback(() => {
    cameraMock.reads += 1;
    setAnswer(cameraMock.permission);
    return Promise.resolve(cameraMock.permission ?? UNDETERMINED);
  }, []);
  return [answer, request, get];
}

// everything else the library offers: a call is a failure of the test (see the tests of AC3)
export const useMicrophonePermissions = (): never => forbidden('useMicrophonePermissions') as never;
export const requestMicrophonePermissionsAsync = (): never => forbidden('requestMicrophonePermissionsAsync') as never;
export const getMicrophonePermissionsAsync = (): never => forbidden('getMicrophonePermissionsAsync') as never;
export const requestCameraPermissionsAsync = (): never => forbidden('requestCameraPermissionsAsync') as never;
export const scanFromURLAsync = (): never => forbidden('scanFromURLAsync') as never;
export const Camera = {
  requestMicrophonePermissionsAsync,
  getMicrophonePermissionsAsync,
  requestCameraPermissionsAsync,
  scanFromURLAsync,
};
