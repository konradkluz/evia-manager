/**
 * Kotlin and Gradle policy on the real repository and on synthetic bad examples (EVM-109 AC3, AC6, AC7; security-engineer M3, M4;
 * architect 4, 9): exact versions, repositories, pinned checksums, JUnit only in tests, no Android logger, a pure engine.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exists, filesBelow, json, read, record, ROOT } from '../src/files.ts';
import {
  binaryLibraryProblems,
  buildCacheProblems,
  denylistProblems,
  enginePurityProblems,
  junitScopeProblems,
  loggingProblems,
  LOGGING_ALLOWLIST,
  propertiesProblems,
  repositoryProblems,
  verificationProblems,
  versionProblems,
  wrapperProblems,
  OFFICIAL_GRADLE_CHECKSUMS,
} from '../src/kotlin.ts';

const ENGINE = 'apps/mobile/modules/evia-upload/engine';
const BUILD = read(`${ENGINE}/build.gradle.kts`);
const SETTINGS = read(`${ENGINE}/settings.gradle.kts`);
const WRAPPER_PROPERTIES = read(`${ENGINE}/gradle/wrapper/gradle-wrapper.properties`);
const wrapperJarSha = (): string =>
  createHash('sha256')
    .update(readFileSync(join(ROOT, `${ENGINE}/gradle/wrapper/gradle-wrapper.jar`)))
    .digest('hex');
const sourcesBelow = (dir: string, extensions: readonly string[]): Record<string, string> =>
  Object.fromEntries(filesBelow(dir, (path) => extensions.some((extension) => path.endsWith(extension))).map((path) => [path, read(path)]));
const kotlinSources = (dir: string): Record<string, string> => sourcesBelow(dir, ['.kt']);
/** Kotlin and Java: a Java file in a module must not log around the redacting logger either (EVM-130, review of EVM-109). */
const moduleSources = (dir: string): Record<string, string> => sourcesBelow(dir, ['.kt', '.java']);

describe('EVM-109 AC6: Gradle supply chain on the real files', () => {
  it('EVM-109 AC6: versions are exact (no +, ranges, latest, SNAPSHOT) in the build script', () => {
    expect(versionProblems('build.gradle.kts', BUILD)).toEqual([]);
    expect(BUILD).toContain('"2.2.21"');
    expect(BUILD).toContain('ktlint-cli:1.8.0:all@jar');
  });

  it('EVM-109 AC6: repositories are Maven Central only, no project-level repositories, no automatic JDK download', () => {
    expect(repositoryProblems(SETTINGS, { 'build.gradle.kts': BUILD })).toEqual([]);
    expect(propertiesProblems(read(`${ENGINE}/gradle.properties`))).toEqual([]);
  });

  it('EVM-109 AC6: the real engine project has the build cache off (CVE-2026-53914 mitigation)', () => {
    expect(buildCacheProblems(read(`${ENGINE}/gradle.properties`), { 'settings.gradle.kts': SETTINGS, 'build.gradle.kts': BUILD })).toEqual(
      [],
    );
  });

  it('EVM-109 AC6: no ML Kit, Firebase, GMS, datatransport, analytics or error-reporting library in any Gradle file', () => {
    const files = {
      'build.gradle.kts': BUILD,
      'settings.gradle.kts': SETTINGS,
      'verification-metadata.xml': read(`${ENGINE}/gradle/verification-metadata.xml`),
    };
    expect(denylistProblems(files)).toEqual([]);
  });

  it('EVM-109 AC6: JUnit (EPL-2.0) is a test dependency only; the production classpath is checked by a Gradle task', () => {
    expect(junitScopeProblems('build.gradle.kts', BUILD)).toEqual([]);
    expect(BUILD).toContain('testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")');
    expect(BUILD).toContain('"org.jetbrains.kotlin:kotlin-stdlib", "org.jetbrains:annotations"');
    expect(BUILD).toContain('checkProductionDependencies');
  });

  it('EVM-109 AC6: the Gradle distribution has a pinned SHA-256 and the wrapper jar equals the official one (gradle.org/release-checksums)', () => {
    expect(wrapperProblems(WRAPPER_PROPERTIES, wrapperJarSha())).toEqual([]);
  });

  it('EVM-109 AC6: every artifact has a SHA-256 in the verification metadata and there are no trust shortcuts', () => {
    expect(verificationProblems(read(`${ENGINE}/gradle/verification-metadata.xml`))).toEqual([]);
  });

  it('EVM-109 AC6: the repository has no binary AAR', () => {
    const paths = ['apps', 'packages', 'tools', 'services'].flatMap((dir) => filesBelow(dir, (path) => /\.aar$/i.test(path)));
    expect(binaryLibraryProblems(paths)).toEqual([]);
  });
});

describe('EVM-109 AC3: logging and purity of module sources on the real files', () => {
  it('EVM-109 AC3: no android.util.Log, System.out, printStackTrace or println in the Kotlin sources of modules, android and plugins', () => {
    const sources = {
      ...moduleSources('apps/mobile/modules'),
      ...moduleSources('apps/mobile/android'),
      ...moduleSources('apps/mobile/plugins'),
    };
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(loggingProblems(sources)).toEqual([]);
    expect(LOGGING_ALLOWLIST).toEqual([]);
  });

  it('EVM-109 AC1: the engine sources do not depend on Android, Google or org.json', () => {
    const main = kotlinSources(`${ENGINE}/src/main`);
    expect(Object.keys(main).length).toBeGreaterThanOrEqual(8);
    expect(enginePurityProblems(main)).toEqual([]);
  });
});

describe('EVM-109 AC5, AC7: thresholds and exclusions on the real files', () => {
  it('EVM-109 AC7: coverage-thresholds.json has the layer "engine" at 95 or more (ratchet) and Gradle reads it from there', () => {
    expect(record(json('packages/config/coverage-thresholds.json'))['engine']).toBeGreaterThanOrEqual(95);
    expect(BUILD).toContain('packages/config/coverage-thresholds.json');
    expect(BUILD).toContain('Missing key `engine`');
    expect(BUILD).toContain('engineThreshold');
  });

  it('EVM-109 AC5: only the Android glue is excluded from coverage, never the pure engine', () => {
    const patterns = (record(json('packages/config/coverage-exclusions.json'))['exclude'] as Array<Record<string, string>>).map(
      (entry) => entry['pattern'] ?? '',
    );
    const upload = patterns.filter((pattern) => pattern.includes('/android/'));
    // EVM-130: an explicit list of glue files, never a glob over android/** (a new file there is measured by coverage:diff)
    expect(upload).toEqual([
      'apps/mobile/modules/evia-keystore/android/src/main/java/pl/eviacharge/keystore/EviaKeystoreModule.kt',
      'apps/mobile/modules/evia-clipboard/android/src/main/java/pl/eviacharge/clipboard/EviaClipboardModule.kt',
      // EVM-130 (A2): the glue of the background upload, one reason per file; the decisions are in the pure engine
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/UploadJobService.kt',
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/EviaUploadModule.kt',
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/TokenKeystore.kt',
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/UploadNotifications.kt',
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/AndroidSystemJobs.kt',
      'apps/mobile/modules/evia-upload/android/src/main/java/pl/eviacharge/upload/android/UploadRuntime.kt',
    ]);
    // every glue file on disk is on the list and has a reason, and no pure file of the engine is (a new glue file must be added on purpose)
    const glue = filesBelow('apps/mobile/modules/evia-upload/android', (path) => path.endsWith('.kt') || path.endsWith('.java'));
    expect(glue.toSorted()).toEqual(upload.filter((pattern) => pattern.includes('/evia-upload/')).toSorted());
    const entries = record(json('packages/config/coverage-exclusions.json'))['exclude'] as Array<Record<string, string>>;
    expect(
      entries.filter((entry) => (entry['pattern'] ?? '').includes('/android/')).every((entry) => (entry['reason'] ?? '').length > 80),
    ).toBe(true);
    expect(upload.some((pattern) => pattern.includes('*'))).toBe(false);
    expect(patterns.some((pattern) => /(^|\/)engine(\/|$)/.test(pattern))).toBe(false);
  });

  it('EVM-109 AC4: the test task of Gradle declares the vectors as an input and the Gradle project reads them from sync-core', () => {
    expect(BUILD).toContain('inputs.dir(vectorsDirectory)');
    expect(BUILD).toContain('packages/sync-core/conformance/upload');
    expect(exists('packages/sync-core/conformance/upload/index.json')).toBe(true);
  });
});

describe('EVM-109 AC6: the checkers reject bad examples', () => {
  it('EVM-109 AC6: inexact versions are found', () => {
    const bad = [
      'implementation("g:a:1.+")',
      'implementation("g:a:[1.0,2.0)")',
      'implementation("g:a:latest.release")',
      'implementation("g:a:1.0-SNAPSHOT")',
      'id("p") version "1.+"',
      'kotlin("jvm") version "2.2.+"',
    ].join('\n');
    expect(versionProblems('b', bad)).toHaveLength(6);
    expect(
      versionProblems('b', 'testImplementation("g:a:6.1.3")\nid("x") version "0.9.11"\nktlint("g:a:1.8.0:all@jar")\nx("g:a:1.0.0-rc1")'),
    ).toEqual([]);
  });

  it('EVM-109 AC6: foreign repositories, missing repositoriesMode and project-level repositories are found', () => {
    const good =
      'dependencyResolutionManagement {\n    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS\n    repositories {\n        mavenCentral()\n        google()\n    }\n}\n';
    expect(repositoryProblems(good, {})).toEqual([]);
    expect(repositoryProblems('', {})).toContain('settings.gradle.kts: brak bloków repositories {}');
    expect(repositoryProblems(good.replace('google()', 'maven("https://jitpack.io")'), {}).join('\n')).toMatch(/niedozwolone repozytorium/);
    expect(repositoryProblems(good.replace('google()', 'gradlePluginPortal()'), {}).join('\n')).toMatch(/niedozwolone/);
    expect(repositoryProblems(good.replace('    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS\n', ''), {}).join('\n')).toMatch(
      /FAIL_ON_PROJECT_REPOS/,
    );
    expect(repositoryProblems(good, { 'build.gradle.kts': 'repositories {\n  mavenCentral()\n}' }).join('\n')).toMatch(
      /repozytoria projektu/,
    );
  });

  it('EVM-109 AC6: denylisted libraries and JUnit outside test scope are found, comments are ignored', () => {
    for (const library of [
      'com.google.mlkit:barcode:1',
      'com.google.firebase:firebase-analytics:1',
      'com.google.android.gms:play-services-base:1',
      'com.google.android.datatransport:x:1',
      'io.sentry:sentry:1',
    ]) {
      expect(denylistProblems({ f: `implementation("${library}")` })).toHaveLength(1);
    }
    expect(denylistProblems({ f: '// com.google.firebase is forbidden here\nimplementation("a:b:1")' })).toEqual([]);
    expect(junitScopeProblems('b', 'implementation("org.junit.jupiter:junit-jupiter:6.1.3")')).toHaveLength(1);
    expect(junitScopeProblems('b', '    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")\n// junit note')).toEqual([]);
  });

  it('EVM-109 AC6: the Gradle build cache is off and not configured (mitigation of CVE-2026-53914)', () => {
    expect(buildCacheProblems('org.gradle.caching=false\n', {})).toEqual([]);
    expect(buildCacheProblems('org.gradle.jvmargs=-Xmx1g', {})).toHaveLength(1);
    expect(buildCacheProblems('org.gradle.caching=true', {})).toHaveLength(1);
    const remote = 'buildCache {\n  remote<HttpBuildCache> { url = uri("https://cache.invalid") }\n}';
    expect(buildCacheProblems('org.gradle.caching=false', { 's.kts': remote })).toHaveLength(1);
    expect(buildCacheProblems('org.gradle.caching=false', { 's.kts': '// buildCache { local }' })).toEqual([]);
  });

  it('EVM-109 AC6: missing gradle properties are found', () => {
    expect(propertiesProblems('org.gradle.jvmargs=-Xmx1g')).toHaveLength(1);
    expect(propertiesProblems('org.gradle.java.installations.auto-download=true')).toHaveLength(1);
  });

  it('EVM-109 AC6: a wrapper without a checksum, with a foreign URL, a changed jar or an unknown version is found', () => {
    const official = OFFICIAL_GRADLE_CHECKSUMS['9.9.1'];
    expect(official).toBeDefined();
    const jar = official?.wrapperJar ?? '';
    const good = `distributionUrl=https\\://services.gradle.org/distributions/gradle-9.9.1-bin.zip\ndistributionSha256Sum=${official?.distribution ?? ''}\nvalidateDistributionUrl=true\n`;
    expect(wrapperProblems(good, jar)).toEqual([]);
    expect(wrapperProblems(good.replace('services.gradle.org', 'evil.example.test'), jar).join('\n')).toMatch(/distributionUrl/);
    expect(wrapperProblems(good.replace(/distributionSha256Sum=.*\n/, ''), jar).join('\n')).toMatch(/distributionSha256Sum/);
    expect(wrapperProblems(good.replace('validateDistributionUrl=true', 'validateDistributionUrl=false'), jar).join('\n')).toMatch(
      /validateDistributionUrl/,
    );
    expect(wrapperProblems(good, 'f'.repeat(64)).join('\n')).toMatch(/gradle-wrapper\.jar/);
    expect(wrapperProblems(good.replace(official?.distribution ?? '', 'a'.repeat(64)), jar).join('\n')).toMatch(
      /oficjalnej sumy dystrybucji/,
    );
    expect(wrapperProblems(good.replaceAll('9.9.1', '9.9.2'), jar).join('\n')).toMatch(/nie ma oficjalnych sum/);
  });

  it('EVM-109 AC6: verification metadata with trust shortcuts, a missing checksum or missing key artifacts is found', () => {
    const artifact = (name: string): string =>
      `<component group="g" name="${name}" version="1"><artifact name="${name}-1.jar"><sha256 value="${'a'.repeat(64)}"/></artifact></component>`;
    const good = `<verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration><components>${['kotlin-gradle-plugin', 'kover-gradle-plugin', 'ktlint-cli', 'junit-jupiter-api'].map(artifact).join('')}</components></verification-metadata>`;
    expect(verificationProblems(good)).toEqual([]);
    expect(verificationProblems(good.replace('true</verify', 'false</verify')).join('\n')).toMatch(/verify-metadata/);
    expect(
      verificationProblems(
        good.replace('<components>', '<trusted-artifacts><trust group=".*" regex="true"/></trusted-artifacts><components>'),
      ).join('\n'),
    ).toMatch(/zakaz <trust>/);
    expect(verificationProblems(good.replace(`<sha256 value="${'a'.repeat(64)}"/>`, '')).join('\n')).toMatch(/bez SHA-256/);
    expect(verificationProblems(good.replace('ktlint-cli', 'other')).join('\n')).toMatch(/brak sum dla ktlint-cli/);
    expect(
      verificationProblems(
        '<verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration></verification-metadata>',
      ).join('\n'),
    ).toMatch(/brak artefaktów/);
  });

  it('EVM-109 AC3: Android and console logging in module sources is found, aliases included', () => {
    for (const code of [
      'import android.util.Log',
      'import android.util.Log as AndroidLog',
      'import android.util.*',
      'android.util.Log.d("t", "m")',
      'System.out.println("x")',
      'System.err.println("x")',
      'error.printStackTrace()',
      'println("x")',
      'print("x")',
      'import timber.log.Timber',
    ]) {
      expect(loggingProblems({ 'A.kt': code }), code).toHaveLength(1);
    }
    expect(loggingProblems({ 'A.kt': 'val line = "log"\nfun printable() = 1\nvalue.printer(1)' })).toEqual([]);
  });

  it('EVM-130 AC5: Android and console logging in Java files of modules is found as well', () => {
    for (const code of [
      'import android.util.Log;',
      'android.util.Log.w(TAG, "m");',
      'System.out.println("x");',
      'System.err.print("x");',
      'error.printStackTrace();',
    ]) {
      expect(loggingProblems({ 'A.java': code }), code).toHaveLength(1);
    }
    expect(loggingProblems({ 'A.java': '// android.util.Log is forbidden\nclass A { int printable() { return 1; } }' })).toEqual([]);
  });

  it('EVM-109 AC1: Android, Google and org.json imports in the engine are found', () => {
    for (const line of [
      'import android.os.Build',
      'import androidx.annotation.Keep',
      'import com.google.gson.Gson',
      'import org.json.JSONObject',
    ]) {
      expect(enginePurityProblems({ 'A.kt': `package a\n${line}\n` }), line).toHaveLength(1);
    }
    expect(
      enginePurityProblems({ 'A.kt': 'package a\nimport java.net.URI\n// import android.os.Build in a comment is text, not an import\n' }),
    ).toHaveLength(0);
  });

  it('EVM-109 AC6: AAR files are found', () => {
    expect(binaryLibraryProblems(['a/b/lib.aar', 'a/b/LIB.AAR', 'a/c/lib.jar'])).toHaveLength(2);
  });
});
