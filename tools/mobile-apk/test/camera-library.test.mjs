import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * A guard of the installed camera library (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06, SR-FILE-08): an update of `expo-camera` (Renovate) must
 * not bring in a way for the picture to leave the private directory of the app or for a position to enter it. The sources are read from
 * node_modules; a missing library fails (fail closed), it is never skipped.
 */
const MOBILE = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const LIBRARY = join(MOBILE, 'node_modules', 'expo-camera');
const ANDROID = join(LIBRARY, 'android');

/** @param {string} path @returns {{ version?: string, dependencies?: Record<string, string> }} */
function readJson(path) {
  /** @type {unknown} */
  let parsed;
  parsed = JSON.parse(readFileSync(path, 'utf8'));
  return /** @type {{ version?: string, dependencies?: Record<string, string> }} */ (parsed);
}

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:kt|java)$/.test(name) ? [path] : [];
  });
}

/** What the library must not use: the public gallery, the external storage, a position of the picture, the camera of another app. */
const FORBIDDEN_IN_SOURCES = [
  'setLocation',
  'MediaStore',
  'getExternal',
  'Environment.DIRECTORY_',
  'ACTION_IMAGE_CAPTURE',
  'ACTION_VIDEO_CAPTURE',
];

describe('the installed camera library (EVM-108 AC8; supply chain guard for updates)', () => {
  it('EVM-108 AC8: the library is installed, in the exact version of package.json (no range)', () => {
    assert.ok(existsSync(ANDROID), 'expo-camera is not installed in apps/mobile/node_modules: run pnpm install');
    const declared = readJson(join(MOBILE, 'package.json')).dependencies?.['expo-camera'];
    const installed = readJson(join(LIBRARY, 'package.json')).version;
    assert.match(declared ?? '', /^\d+\.\d+\.\d+$/, 'expo-camera must be pinned to an exact version');
    assert.equal(installed, declared);
  });

  it('EVM-108 AC8: the Android sources do not write to the gallery or the external storage, do not set a position and start no camera of another app', () => {
    const files = sourceFiles(ANDROID);
    assert.ok(files.length > 10, 'the sources of the library were not found');
    /** @type {string[]} */
    const found = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const word of FORBIDDEN_IN_SOURCES) if (text.includes(word)) found.push(`${word} in ${file.slice(ANDROID.length + 1)}`);
    }
    assert.deepEqual(found, []);
  });

  it('EVM-108 AC8: the build file of the library adds no repository other than Google and Maven Central, and no local one', () => {
    const gradle = readFileSync(join(ANDROID, 'build.gradle'), 'utf8');
    const repositories = [...gradle.matchAll(/\b(?:maven\s*\{|mavenLocal\s*\(|jcenter\s*\(|url\s+['"(])/g)].map((match) => match[0]);
    assert.deepEqual(repositories, []);
  });

  it('EVM-108 AC8: both Google scanners are optional in the build file (compileOnly when the property is false), the baseline of the plugin', () => {
    const gradle = readFileSync(join(ANDROID, 'build.gradle'), 'utf8');
    assert.match(gradle, /findProperty\('expo\.camera\.barcode-scanner-enabled'\)/);
    assert.match(gradle, /findProperty\('expo\.camera\.document-scanner-enabled'\)/);
    assert.match(gradle, /isBarcodeScannerEnabled \? "implementation" : "compileOnly"/);
    assert.match(gradle, /isDocumentScannerEnabled \? "implementation" : "compileOnly"/);
  });

  it('EVM-108 AC8: the manifest of the library asks for the camera only, and its ML Kit meta-data is the one the plugin removes', () => {
    const manifestPath = join(ANDROID, 'src', 'main', 'AndroidManifest.xml');
    const manifest = readFileSync(manifestPath, 'utf8');
    const permissions = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(permissions, ['android.permission.CAMERA']);
    const metas = [...manifest.matchAll(/<meta-data[^>]*android:name="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(metas, ['com.google.mlkit.vision.DEPENDENCIES']);
  });
});
