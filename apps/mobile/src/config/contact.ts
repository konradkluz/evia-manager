import Constants from 'expo-constants';
import { readContactConfig, type ContactConfig } from './contact-values';

/** The contact data of the build (`extra.contactEmail`, `extra.contactPhone`; EVM-102 AC3); absent in an Expo Go or test environment. */
export function readContact(): ContactConfig {
  const config: unknown = Constants.expoConfig;
  return readContactConfig(typeof config === 'object' && config !== null && 'extra' in config ? config.extra : undefined);
}
