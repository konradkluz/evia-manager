/**
 * Runtime configuration of the app (EVM-009 AC2, AC6): API address, platform and version. The address comes from the build
 * (EXPO_PUBLIC_API_BASE_URL is inlined by Metro and is the only EXPO_PUBLIC_* variable of the bundle; it holds no secret) and is
 * validated again here: HTTPS only, plain HTTP for the emulator host in the e2e variant only.
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ClientPlatform } from '../api/health';
import { parseApiBaseUrl, resolveBuildVariant } from './api-base-url';

export interface RuntimeConfig {
  readonly apiBaseUrl: string;
  readonly platform: ClientPlatform;
  readonly appVersion: string;
}

/** The build variant recorded by app.config.ts in `extra` (absent in an Expo Go or test environment). */
function declaredBuildVariant(): string | undefined {
  const config: unknown = Constants.expoConfig;
  if (typeof config !== 'object' || config === null || !('extra' in config)) return undefined;
  const extra: unknown = config.extra;
  if (typeof extra !== 'object' || extra === null || !('buildVariant' in extra)) return undefined;
  return typeof extra.buildVariant === 'string' ? extra.buildVariant : undefined;
}

/** Inlined by Metro at bundle time (only literal `process.env.EXPO_PUBLIC_*` accesses are replaced). */
function buildApiBaseUrl(): string | undefined {
  const value: unknown = process.env.EXPO_PUBLIC_API_BASE_URL;
  return typeof value === 'string' ? value : undefined;
}

/** @returns `null` when the API address is missing or not allowed (the app then reports the server as unavailable) */
export function readRuntimeConfig(rawBaseUrl: string | undefined = buildApiBaseUrl()): RuntimeConfig | null {
  const variant = resolveBuildVariant(declaredBuildVariant());
  const url = parseApiBaseUrl(rawBaseUrl, { allowLocalHttp: variant === 'e2e' });
  if (!url.ok) return null;
  return {
    apiBaseUrl: url.url,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    // `version` of app.config.ts is the single source; the native value is the installed one.
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown',
  };
}
