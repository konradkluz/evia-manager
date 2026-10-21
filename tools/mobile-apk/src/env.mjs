// @ts-check
/**
 * The environment of child processes (EVM-009 AC5; security-engineer): an allow-list, so that the password variables of the owner
 * (EVIA_APK_KS_PASS, EVIA_APK_KEY_PASS) and any other secret of the shell reach only the process that needs them — `apksigner sign`.
 * Executables are resolved to an absolute path from PATH (never from the current directory, which Windows searches first).
 */
import { delimiter, isAbsolute, join } from 'node:path';

/** Variables the tools need to start and to find the SDK, the JDK and the home of git; compared without regard to case. */
export const PASSED_ENV = Object.freeze([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'USERPROFILE',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'JAVA_HOME',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
]);

/**
 * @param {NodeJS.ProcessEnv} base
 * @returns {Record<string, string>}
 */
export function childEnv(base) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && PASSED_ENV.includes(name.toUpperCase())) env[name] = value;
  }
  // honoured by Windows APIs and by cmd; the explicit resolution below is the real protection for Node's own search
  env['NoDefaultCurrentDirectoryInExePath'] = '1';
  return env;
}

/**
 * The first absolute directory of PATH that holds the program (no relative entries, no current directory).
 * @param {string} name program name without extension
 * @param {{ env: NodeJS.ProcessEnv, platform: string, exists: (path: string) => boolean }} host
 * @returns {string | null}
 */
export function resolveProgram(name, host) {
  const entry = Object.entries(host.env).find(([key]) => key.toUpperCase() === 'PATH');
  const directories = (entry?.[1] ?? '').split(delimiter).filter((directory) => directory !== '' && isAbsolute(directory));
  const file = host.platform === 'win32' ? `${name}.exe` : name;
  for (const directory of directories) {
    const candidate = join(directory, file);
    if (host.exists(candidate)) return candidate;
  }
  return null;
}
