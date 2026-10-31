import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..');

function files(directory: string, pattern = /\.tsx?$/): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, pattern) : pattern.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
/** The paths (relative, with forward slashes) among `paths` whose content matches `pattern`. */
const matching = (paths: string[], pattern: RegExp) =>
  paths.filter((path) => pattern.test(read(path))).map((path) => path.slice(APP.length + 1).replaceAll('\\', '/'));

describe('security and design rules of the app source (EVM-009 AC1, AC6)', () => {
  it('EVM-009 AC1: no literal colour, no inline hex or rgb value in the UI library and the screens (tokens only)', () => {
    const sources = [...files(join(APP, 'src', 'ui')), ...files(join(APP, 'src', 'screens'))];
    expect(sources.length).toBeGreaterThan(10);
    expect(matching(sources, /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/)).toEqual([]);
  });

  it('EVM-009 AC6: AsyncStorage is neither a dependency nor an import — tokens and data never go to plain-text storage (SR-MOB-01)', () => {
    expect(read(join(APP, 'package.json'))).not.toContain('async-storage');
    expect(matching(files(join(APP, 'src')), /async-storage/)).toEqual([]);
  });

  it('EVM-009 AC6: expo-secure-store is imported only by the token store (SR-MOB-03)', () => {
    expect(matching(files(join(APP, 'src')), /'expo-secure-store'/)).toEqual(['src/secure-store/token-store.ts']);
  });

  it('EVM-009 AC6: no OTA updates, developer client, router, analytics or crash-reporting SDK among the dependencies (SR-MOB-09, SR-PRIV-09)', () => {
    const manifest = read(join(APP, 'package.json'));
    const found = [
      'expo-updates',
      'expo-dev-client',
      'expo-router',
      '@sentry',
      'firebase',
      'analytics',
      'eas-cli',
      'amplitude',
      'segment',
    ].filter((forbidden) => manifest.includes(forbidden));
    expect(found).toEqual([]);
  });

  it('EVM-009 AC6: the app writes no console output; only the logger names fixed events (SR-LOG-08)', () => {
    const sources = files(join(APP, 'src')).filter((path) => !path.endsWith(join('logging', 'log.ts')));
    expect(matching(sources, /\bconsole\./)).toEqual([]);
  });

  it('EVM-009 AC6: the only EXPO_PUBLIC_ variable in the source is EXPO_PUBLIC_API_BASE_URL, and no key or token is hard-coded', () => {
    const sources = [...files(join(APP, 'src')), join(APP, 'app.config.ts'), ...files(join(APP, 'plugins'))];
    const names = new Set(sources.flatMap((path) => [...read(path).matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)].map((match) => match[0])));
    expect([...names]).toEqual(['EXPO_PUBLIC_API_BASE_URL']);
    expect(matching(sources, /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[0-9A-Za-z]{36,}\b/)).toEqual([]);
  });

  it('EVM-093 AC1: expo-sqlite is imported only by the SQLCipher driver, and none of its risky surfaces is used (security review 7)', () => {
    const sources = [...files(join(APP, 'src')), ...files(join(APP, 'plugins'))];
    expect(matching(sources, /from 'expo-sqlite[^']*'|require\('expo-sqlite/)).toEqual(['src/storage/expo-sqlite-driver.ts']);
    expect(
      matching(
        sources,
        /expo-sqlite\/(kv-store|localStorage)|serializeAsync|backupDatabase|deserializeDatabase|loadExtension|locking_mode/,
      ),
    ).toEqual([]);
    const driver = read(join(APP, 'src', 'storage', 'expo-sqlite-driver.ts'));
    // one argument (no options, no custom directory); the name is the app database or the e2e copy of scenario 13
    expect([...driver.matchAll(/openDatabaseAsync\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['name']);
    const sources2 = [...files(join(APP, 'src')), ...files(join(APP, 'plugins'))];
    const calls = sources2.flatMap((path) => [...read(path).matchAll(/createExpoSqliteEngine\(([^)]*)\)/g)].map((m) => m[1]));
    expect(calls.sort()).toEqual(['', 'E2E_COPY_NAME', 'name: string = DATABASE_NAME'].sort());
  });

  it('EVM-093 AC1: the e2e hooks are reachable only through their empty slot; the support of the store is used by the panel only', () => {
    const sources = [...files(join(APP, 'src')), ...files(join(APP, 'plugins')), join(APP, 'index.ts')];
    // nothing imports the panel: only the Metro resolver of the e2e variant swaps the slot for it
    expect(matching(sources, /from '[^']*e2e-hooks\/panel|require\([^)]*e2e-hooks\/panel/)).toEqual([]);
    expect(matching(sources, /from '\.\/e2e-hooks'|from '\.\.\/e2e-hooks'/)).toEqual(['src/App.tsx']);
    const slot = read(join(APP, 'src', 'e2e-hooks', 'index.ts'));
    expect(slot).not.toMatch(/^import /m);
    expect(slot).not.toContain('evia-e2e-hooks-panel');
    const outsideStorage = sources.filter((path) => !path.includes(join('src', 'storage')));
    expect(matching(outsideStorage, /storageE2eSupport|wipeFaultForE2e/)).toEqual(['src/e2e-hooks/panel.tsx']);
    expect(matching(sources, /evia-e2e-hooks-panel/)).toEqual(['src/e2e-hooks/panel.tsx']);
    // the hooks never touch the database driver or the key directly
    expect(read(join(APP, 'src', 'e2e-hooks', 'panel.tsx'))).not.toMatch(/from 'expo-sqlite|tokenStore\.get|keyPragma|KEY_CHECK/);
  });

  it('EVM-093 AC1: the marker of the hooks is the one tools/mobile-apk verify searches in a release bundle', () => {
    const contents = read(join(APP, '..', '..', 'tools', 'mobile-apk', 'src', 'contents.mjs'));
    expect(contents).toContain("export const E2E_HOOKS_MARKER = 'evia-e2e-hooks-panel';");
    expect(read(join(APP, 'src', 'e2e-hooks', 'panel.tsx'))).toContain("export const E2E_HOOKS_MARKER = 'evia-e2e-hooks-panel';");
  });

  it('EVM-093 AC1: keys come from the CSPRNG of expo-crypto only — no Math.random anywhere in the app source', () => {
    expect(matching(files(join(APP, 'src')), /Math\.random/)).toEqual([]);
    expect(matching(files(join(APP, 'src')), /'expo-crypto'/)).toEqual(['src/storage/platform.ts']);
  });

  it('EVM-093 AC7: the SQL stores are reachable only through the owner guard (not exported, not imported outside the store)', () => {
    const barrel = read(join(APP, 'src', 'storage', 'index.ts'));
    expect(barrel).not.toMatch(/SqlQueueStore|SqlReplicaStore|queue-store|replica-store|from '\.\/database'/);
    const outside = files(join(APP, 'src')).filter((path) => !path.includes(join('src', 'storage')));
    expect(matching(outside, /storage\/(queue-store|replica-store|database|local-data|expo-sqlite-driver|platform)'/)).toEqual([]);
  });

  it('EVM-100 AC1 (security W4): no React Native Modal or native Alert — their own Android windows do not inherit FLAG_SECURE', () => {
    const sources = files(join(APP, 'src'));
    expect(matching(sources, /import\s*\{[^}]*\b(Modal|Alert)\b[^}]*\}\s*from\s*'react-native'/)).toEqual([]);
    expect(matching(sources, /\bAlert\.alert\(|\bToastAndroid\b/)).toEqual([]);
  });

  it('EVM-100 AC1 (security W3): the installation proof is unwrapped only by the HTTP adapter of the sign-in', () => {
    const outsideStorage = files(join(APP, 'src')).filter((path) => !path.includes(join('src', 'storage')));
    expect(matching(outsideStorage, /installation-proof'/)).toEqual(['src/api/auth-client.ts']);
    expect(matching(files(join(APP, 'src')), /\bproofFields\(/)).toEqual(['src/api/auth-client.ts', 'src/storage/installation-proof.ts']);
  });

  it('EVM-100 AC1 (architect 4): only the session owner and the composition know the token store; screens never import it', () => {
    expect(matching(files(join(APP, 'src')), /from '[^']*secure-store'/).sort()).toEqual(
      ['src/e2e-hooks/panel.tsx', 'src/secure-store/token-store.ts', 'src/session.ts', 'src/storage/platform.ts'].sort(),
    );
    expect(matching(files(join(APP, 'src', 'screens')), /\.refresh\(|\.logout\(|TokenStore/)).toEqual(['src/screens/SessionRoot.tsx']);
  });

  it('EVM-009 AC6: the native projects generated by expo prebuild are never committed (CNG)', () => {
    const ignore = readFileSync(join(APP, '..', '..', '.gitignore'), 'utf8');
    expect(ignore).toContain('apps/mobile/android/');
    expect(ignore).toContain('apps/mobile/ios/');
  });
});
