/**
 * Policy of the Kotlin / Gradle part of the repository (EVM-109 AC3, AC6; security-engineer M3, M4; architect 4, 9): exact versions,
 * repositories, pinned checksums, a production classpath without test libraries, no Android logger and no Android dependency in the pure
 * engine. Checkers return a list of problems (empty = fine); the tests run them on the real files and on synthetic bad examples.
 */

/**
 * Official SHA-256 sums of the Gradle distribution and of its `gradle-wrapper.jar`, per version. Source: https://gradle.org/release-checksums/
 * (and https://services.gradle.org/distributions/gradle-<version>-bin.zip.sha256, ...-wrapper.jar.sha256), copied on 2026-11-14.
 */
export const OFFICIAL_GRADLE_CHECKSUMS: Readonly<Record<string, { distribution: string; wrapperJar: string }>> = Object.freeze({
  '9.9.1': {
    distribution: 'd8a18a7a841dd5df825d35a685fad6f2d7f12ac0c280e57b67c27b4a520ba228',
    wrapperJar: '621008afc4f5d59357fcf06ffa644dd5aade5e091bdc363742710445f73cdaf8',
  },
});

const EXACT_VERSION = /^\d+(\.\d+)*([-.]?[A-Za-z][A-Za-z0-9]*)?$/;
const COORDINATE = /"([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^":@]+)(?::[A-Za-z0-9_.-]+)?(?:@[a-z]+)?"/g;
const PLUGIN_VERSION = /\bversion\s+"([^"]+)"/g;
/** Groups and libraries that must never enter the mobile app (EVM-108 denylist, SR-SUPPLY-06, SR-MOB-11): ML Kit, Firebase, GMS, analytics. */
const DENYLIST =
  /(mlkit|firebase|android\.gms|play-services|play\.integrity|datatransport|sentry|crashlytics|bugsnag|appcenter|amplitude|mixpanel|segment\.analytics|analytics)/i;

/** Source without `//` line comments and block comments (a mention in a comment is not a use). */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '');

/** Versions without `+`, ranges, `latest.*` and SNAPSHOT (AC6). */
export function versionProblems(file: string, script: string): string[] {
  const versions = [
    ...[...script.matchAll(COORDINATE)].map((match) => ({ what: `${match[1] ?? ''}:${match[2] ?? ''}`, version: match[3] ?? '' })),
    ...[...script.matchAll(PLUGIN_VERSION)].map((match) => ({ what: 'plugin', version: match[1] ?? '' })),
  ];
  return versions.flatMap(({ what, version }) =>
    EXACT_VERSION.test(version) && !/snapshot|latest/i.test(version) ? [] : [`${file}: niedokładna wersja ${what} -> "${version}"`],
  );
}

/** Repositories: only Maven Central and Google, no project-level repositories, no JitPack / Plugin Portal / local (AC6, SR-SUPPLY-04). */
export function repositoryProblems(settingsFile: string, buildScripts: Record<string, string>): string[] {
  const problems: string[] = [];
  const settings = withoutComments(settingsFile);
  const blocks = [...settings.matchAll(/repositories\s*\{([\s\S]*?)\n\s{0,8}\}/g)].map((match) => match[1] ?? '');
  if (blocks.length === 0) problems.push('settings.gradle.kts: brak bloków repositories {}');
  for (const block of blocks) {
    const calls = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'));
    for (const call of calls) {
      if (call !== 'mavenCentral()' && call !== 'google()') problems.push(`settings.gradle.kts: niedozwolone repozytorium: ${call}`);
    }
  }
  if (!/repositoriesMode\s*=\s*RepositoriesMode\.FAIL_ON_PROJECT_REPOS/.test(settings)) {
    problems.push('settings.gradle.kts: brak repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS');
  }
  if (/jitpack|gradlePluginPortal|mavenLocal|jcenter|flatDir|\bmaven\s*[({]/i.test(settings)) {
    problems.push('settings.gradle.kts: niedozwolone źródło (JitPack, Plugin Portal, mavenLocal, flatDir albo własny URL)');
  }
  for (const [file, script] of Object.entries(buildScripts)) {
    if (/\brepositories\s*\{/.test(script)) problems.push(`${file}: repozytoria projektu są zabronione (FAIL_ON_PROJECT_REPOS)`);
  }
  return problems;
}

/** Denylisted libraries in any Gradle file (AC6; security-engineer: ML Kit, Firebase, GMS, analytics, error reporting). */
export function denylistProblems(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([file, content]) => {
    const hit = DENYLIST.exec(content.replace(/^\s*\/\/.*$/gm, ''));
    return hit ? [`${file}: zabroniona biblioteka (${hit[1] ?? ''})`] : [];
  });
}

/** JUnit (EPL-2.0) only as a test dependency: every line that names it starts a `test*` configuration (AC6, decision 2026-11-14). */
export function junitScopeProblems(file: string, script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /junit/i.test(line) && !line.startsWith('//') && !line.startsWith('useJUnitPlatform('))
    .filter((line) => !/^(testImplementation|testRuntimeOnly)\(/.test(line))
    .map((line) => `${file}: JUnit poza zależnością testową: ${line}`);
}

/** `gradle.properties`: no automatic download of toolchains (foojay) — the JDK comes from JAVA_HOME or the CI setup. */
export function propertiesProblems(properties: string): string[] {
  return /^org\.gradle\.java\.installations\.auto-download=false$/m.test(properties)
    ? []
    : ['gradle.properties: brak org.gradle.java.installations.auto-download=false'];
}

/**
 * Gradle build cache off (local and remote): the mitigation of CVE-2026-53914 / GHSA-r937-wjx7-w2jp (unsafe deserialization in the Kotlin
 * build cache; the fix is in Kotlin 2.4.20-Beta1, the engine stays on 2.2.21 for Expo 58). Without a build cache nothing is deserialized from it.
 */
export function buildCacheProblems(properties: string, scripts: Record<string, string>): string[] {
  const problems: string[] = [];
  if (!/^org\.gradle\.caching=false$/m.test(properties)) problems.push('gradle.properties: brak org.gradle.caching=false');
  for (const [file, script] of Object.entries(scripts)) {
    if (/\bbuildCache\s*\{/.test(withoutComments(script)))
      problems.push(`${file}: konfiguracja buildCache (lokalna lub zdalna) jest zabroniona`);
  }
  return problems;
}

/** The wrapper: distribution over HTTPS from services.gradle.org with its SHA-256 and `validateDistributionUrl`, jar equal to the official one. */
export function wrapperProblems(properties: string, jarSha256: string): string[] {
  const problems: string[] = [];
  const value = (key: string): string => new RegExp(`^${key}=(.*)$`, 'm').exec(properties)?.[1]?.trim() ?? '';
  const url = value('distributionUrl').replaceAll('\\', '');
  const version = /^https:\/\/services\.gradle\.org\/distributions\/gradle-(\d+(?:\.\d+)*)-bin\.zip$/.exec(url)?.[1];
  if (version === undefined)
    problems.push('gradle-wrapper.properties: distributionUrl musi być https://services.gradle.org/distributions/gradle-<wersja>-bin.zip');
  if (value('validateDistributionUrl') !== 'true') problems.push('gradle-wrapper.properties: brak validateDistributionUrl=true');
  const sum = value('distributionSha256Sum');
  if (!/^[0-9a-f]{64}$/.test(sum)) problems.push('gradle-wrapper.properties: brak distributionSha256Sum (64 znaki szesnastkowe)');
  const official = version === undefined ? undefined : OFFICIAL_GRADLE_CHECKSUMS[version];
  if (version !== undefined && official === undefined) {
    problems.push(
      `wersja Gradle ${version} nie ma oficjalnych sum w tools/repo-policy/src/kotlin.ts (dopisz je z gradle.org/release-checksums)`,
    );
  }
  if (official !== undefined) {
    if (sum !== official.distribution) problems.push('distributionSha256Sum różni się od oficjalnej sumy dystrybucji z gradle.org');
    if (jarSha256 !== official.wrapperJar)
      problems.push('gradle-wrapper.jar różni się od oficjalnego (SHA-256 z gradle.org/release-checksums)');
  }
  return problems;
}

const REQUIRED_VERIFIED = ['kotlin-gradle-plugin', 'kover-gradle-plugin', 'ktlint-cli', 'junit-jupiter-api'];

/** `gradle/verification-metadata.xml`: verification on, a SHA-256 for every artifact, no trust shortcuts (AC6, SR-SUPPLY-04/06). */
export function verificationProblems(xml: string): string[] {
  const problems: string[] = [];
  if (!/<verify-metadata>true<\/verify-metadata>/.test(xml)) problems.push('verification-metadata.xml: verify-metadata musi być true');
  if (/<trust\b|<trusted-|<also-trust|<ignored-keys|<trusted-key/.test(xml)) {
    problems.push('verification-metadata.xml: zakaz <trust>, <trusted-keys> i <ignored-keys> (żadnych skrótów w weryfikacji)');
  }
  const artifacts = [...xml.matchAll(/<artifact name="[^"]+">([\s\S]*?)<\/artifact>/g)];
  if (artifacts.length === 0) problems.push('verification-metadata.xml: brak artefaktów');
  for (const artifact of artifacts) {
    if (!/<sha256 value="[0-9a-f]{64}"/.test(artifact[1] ?? '')) problems.push('verification-metadata.xml: artefakt bez SHA-256');
  }
  for (const name of REQUIRED_VERIFIED) {
    if (!xml.includes(`name="${name}"`)) problems.push(`verification-metadata.xml: brak sum dla ${name}`);
  }
  return problems;
}

/** Android logging and console output are forbidden in module sources; logs go through the redacting logger (AC3, SR-LOG-02, TM-86). */
const FORBIDDEN_LOGGING: ReadonlyArray<[RegExp, string]> = [
  [/\bandroid\.util\.Log\b/, 'android.util.Log'],
  [/import\s+android\.util\.\*/, 'import android.util.*'],
  [/\bSystem\.(?:out|err)\b/, 'System.out / System.err'],
  [/\.printStackTrace\s*\(/, 'printStackTrace'],
  [/(?<![.\w])print(?:ln)?\s*\(/, 'print / println'],
  [/\btimber\.log\b/i, 'Timber'],
];

/**
 * Module sources (`apps/mobile/modules/**`, `apps/mobile/android`, `apps/mobile/plugins`): no direct logging. No exception exists yet; the
 * platform sink of the redacting logger (EVM-130) is added to an explicit allowlist only after a review.
 */
export const LOGGING_ALLOWLIST: readonly string[] = [];

export function loggingProblems(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, content]) =>
    LOGGING_ALLOWLIST.includes(file)
      ? []
      : FORBIDDEN_LOGGING.filter(([pattern]) => pattern.test(withoutComments(content))).map(
          ([, name]) => `${file}: zakazane logowanie (${name})`,
        ),
  );
}

/** The pure engine has no Android, Google or JSON-library dependency (AC1: tested on the JVM without an emulator). */
export function enginePurityProblems(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, content]) =>
    /^\s*import\s+(?:android\.|androidx\.|com\.google\.|org\.json)/m.test(content)
      ? [`${file}: silnik nie może zależeć od Androida, Google ani org.json`]
      : [],
  );
}

/** Binary Android libraries in the repository are forbidden (AC6). */
export function binaryLibraryProblems(paths: readonly string[]): string[] {
  return paths.filter((path) => /\.aar$/i.test(path)).map((path) => `${path}: binarny AAR w repozytorium`);
}

/**
 * EVM-108 AC8 (SR-FILE-08, SR-MOB-02; CWE-359, CWE-927): the camera is the in-app one (CameraX); native sources must not reach for the camera of
 * another app (an intent writes a position and copies to the gallery or the cloud), the public gallery, the external storage, or put a
 * position into a picture. The same words are banned in TypeScript by the ESLint rules of the mobile app.
 */
const FORBIDDEN_CAMERA_ACCESS: ReadonlyArray<[RegExp, string]> = [
  [/\bMediaStore\b/, 'MediaStore'],
  [/\bACTION_(?:IMAGE|VIDEO)_CAPTURE\b|android\.media\.action\.(?:IMAGE|VIDEO)_CAPTURE/, 'zamiar aparatu systemowego'],
  [/\bgetExternal\w*\s*\(|\bEnvironment\.DIRECTORY_/, 'pamięć zewnętrzna'],
  [/\bsetLocation\b/, 'pozycja w zdjęciu (setLocation)'],
  [/\bTAG_GPS\w*/, 'znacznik GPS w EXIF'],
  // EVM-110 (SEC-110-16): the network of a video is read from NetworkCapabilities only - no name of a network, no WifiManager
  [/\bWifiManager\b|\bgetSSID\b|\bgetBSSID\b|\bgetConnectionInfo\b|\bNEARBY_WIFI_DEVICES\b/, 'nazwa sieci Wi-Fi albo WifiManager'],
  // EVM-110 (SEC-110-03): films have no sound and the app has no microphone
  [/\bAudioRecord\b|\bMediaRecorder\b|\bwithAudioEnabled\b|\bRECORD_AUDIO\b/, 'mikrofon'],
];

export function cameraSourceProblems(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, content]) =>
    FORBIDDEN_CAMERA_ACCESS.filter(([pattern]) => pattern.test(withoutComments(content))).map(
      ([, name]) => `${file}: zakazane w kodzie natywnym aparatu (${name})`,
    ),
  );
}
