import type { ExpoConfig } from 'expo/config';
import { buildExpoConfig } from './plugins/expo-config.ts';

export default (): ExpoConfig => buildExpoConfig(process.env);
