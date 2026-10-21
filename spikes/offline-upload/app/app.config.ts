import type { ExpoConfig } from 'expo/config';

// EVM-011 SPIKE variant: own application id and label so that it never overwrites apps/mobile (pl.eviacharge.manager) or its data.
// Never built in CI, never given to technicians. No expo-updates (OTA off), no analytics, no crash reporter.
export const SPIKE_APPLICATION_ID = 'pl.eviacharge.spike.offlineupload';

// Permissions the prebuild template or libraries add by default; the spike needs none of them (MASVS-PRIVACY-1).
export const BLOCKED_ANDROID_PERMISSIONS: readonly string[] = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_MEDIA_LOCATION',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
];

export default (): ExpoConfig => ({
  name: 'EVM-011 SPIKE',
  slug: 'evm011-spike',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  android: {
    package: SPIKE_APPLICATION_ID,
    versionCode: 1,
    permissions: [],
    blockedPermissions: [...BLOCKED_ANDROID_PERMISSIONS],
  },
  plugins: [
    // Video is recorded muted and the app has no RECORD_AUDIO: the emulator microphone is the host microphone.
    ['expo-camera', { cameraPermission: 'EVM-011 spike: camera test with synthetic scenes', recordAudioAndroid: false }],
    ['expo-sqlite', { useSQLCipher: true }],
    'expo-secure-store',
    './plugins/with-spike-hardening.ts',
  ],
});
