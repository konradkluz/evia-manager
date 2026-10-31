// @ts-check
// Metro configuration (EVM-093): the Expo defaults plus the bundle-time choice of the e2e hooks (plugins/e2e-hooks-resolver.ts).
import expoMetroConfig from 'expo/metro-config';
import { e2eHooksResolver } from './plugins/e2e-hooks-resolver.ts';

const variant = /** @type {Record<string, string | undefined>} */ (process.env)['EVIA_BUILD_VARIANT'];
const config = expoMetroConfig.getDefaultConfig(import.meta.dirname);

export default {
  ...config,
  resolver: {
    ...config.resolver,
    resolveRequest: /** @type {never} */ (e2eHooksResolver(variant, import.meta.dirname)),
  },
};
