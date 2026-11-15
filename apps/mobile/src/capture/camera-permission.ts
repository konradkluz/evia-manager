/**
 * The permission of the camera (EVM-108 AC3). ONLY the camera: the app never asks for the microphone, the location or the storage (the
 * photo goes to the private folder of the app, the manifest has `CAMERA` alone; the film and the sound are outside version 1).
 * The four states of the explaining screen: `undetermined` (nothing asked yet), `granted`, `denied_can_ask` (the system may still ask),
 * `denied_blocked` (the system will not ask again: only the settings of the phone help). `null` = the first reading is not there yet.
 * After the return from the settings (the app is in the foreground again) the permission is read again: a granted one starts the camera
 * by itself, no second entry is needed.
 */
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect } from 'react';
import { AppState, Linking } from 'react-native';

export type CameraPermissionState = 'undetermined' | 'granted' | 'denied_can_ask' | 'denied_blocked';

/** The part of the answer of the system that the state is made of. */
export interface PermissionAnswer {
  readonly status: string;
  readonly canAskAgain: boolean;
}

/** An unknown status is treated as "not granted, not asked yet": the explaining screen is shown, never a camera by mistake. */
export function permissionState(answer: PermissionAnswer | null): CameraPermissionState | null {
  if (answer === null) return null;
  if (answer.status === 'granted') return 'granted';
  if (answer.status === 'denied') return answer.canAskAgain ? 'denied_can_ask' : 'denied_blocked';
  return 'undetermined';
}

export interface CameraPermission {
  readonly state: CameraPermissionState | null;
  /** [Zezwól na dostęp do aparatu]: the system prompt (the answer changes `state`). */
  readonly request: () => void;
  /** [Otwórz ustawienia]: the settings of the app in the phone; a refusal of the system is silent (the screen stays as it is). */
  readonly openSettings: () => void;
}

export function useCameraPermission(): CameraPermission {
  const [answer, requestPermission, getPermission] = useCameraPermissions();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void getPermission().catch(() => undefined);
    });
    return () => {
      subscription.remove();
    };
  }, [getPermission]);
  const request = useCallback(() => {
    void requestPermission().catch(() => undefined);
  }, [requestPermission]);
  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);
  return { state: permissionState(answer), request, openSettings };
}
