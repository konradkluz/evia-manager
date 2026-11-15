import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkGradleDependencies, checkMapping, REQUIRED_PROJECTS } from '../src/gradle-deps.mjs';
import { FORBIDDEN_MAVEN_GROUPS, FORBIDDEN_PACKAGE_PREFIXES, forbiddenPrefixOf, isForbiddenCoordinate } from '../src/forbidden.mjs';

const SEPARATOR = '------------------------------------------------------------';
const HEADER = "releaseRuntimeClasspath - Runtime classpath of compilation 'release' (target  (androidJvm)).";
/**
 * The shape of `gradlew <project>:dependencies --configuration releaseRuntimeClasspath` (synthetic content).
 * @param {string} project
 * @param {string[]} lines the tree lines of the configuration
 * @param {string} [header]
 */
const report = (project, lines, header = HEADER) =>
  [
    `> Task ${project}:dependencies`,
    '',
    SEPARATOR,
    `Project '${project}'`,
    SEPARATOR,
    '',
    header,
    ...lines,
    '',
    '(c) - A dependency constraint, not a dependency.',
    '',
    'A web-based, searchable dependency report is available by running :dependencies --scan.',
    '',
  ].join('\n');
const CLEAN = ['+--- androidx.core:core-ktx:1.18.0', '|    \\--- androidx.core:core:1.18.0', '\\--- project :expo-modules-core'];
const BOTH = (/** @type {string[]} */ app, /** @type {string[]} */ camera = CLEAN) =>
  `${report(':app', app)}\n${report(':expo-camera', camera)}`;
const ROOT = 'the root of the configuration';

describe('Gradle dependency tree of the release runtime classpath (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06)', () => {
  it('EVM-108 AC8: the app and the camera library are both required, by default', () => {
    assert.deepEqual([...REQUIRED_PROJECTS], [':app', ':expo-camera']);
  });

  it('EVM-108 AC8: a clean tree of both projects has no finding', () => {
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN)), []);
  });

  it('EVM-108 AC8: every forbidden group is found with the coordinate and the parent, deep in the tree too (never the content)', () => {
    for (const group of [...FORBIDDEN_MAVEN_GROUPS]) {
      const tree = [
        '+--- androidx.core:core-ktx:1.18.0',
        '|    \\--- androidx.camera:camera-core:1.6.0',
        `|         \\--- ${group}:thing:1.0.0`,
      ];
      assert.deepEqual(checkGradleDependencies(BOTH(tree)), [
        `:app: ${group}:thing in releaseRuntimeClasspath (from androidx.camera:camera-core)`,
      ]);
    }
  });

  it('EVM-108 AC8: the parent may be a project, and a sibling after a deeper branch is attributed to its own parent', () => {
    const tree = [
      '+--- project :expo-camera',
      '|    +--- androidx.camera:camera-core:1.6.0',
      '|    |    \\--- androidx.core:core:1.18.0',
      '|    \\--- com.google.mlkit:barcode-scanning:17.3.0',
      '\\--- androidx.appcompat:appcompat:1.7.1',
    ];
    assert.deepEqual(checkGradleDependencies(BOTH(tree)), [
      ':app: com.google.mlkit:barcode-scanning in releaseRuntimeClasspath (from project :expo-camera)',
    ]);
  });

  it('EVM-108 AC8: the ML Kit artifact of CameraX is forbidden, the rest of CameraX is not', () => {
    const tree = ['+--- androidx.camera:camera-core:1.6.0', '\\--- androidx.camera:camera-mlkit-vision:1.6.0'];
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, tree)), [
      `:expo-camera: androidx.camera:camera-mlkit-vision in releaseRuntimeClasspath (from ${ROOT})`,
    ]);
  });

  it('EVM-108 AC8: markers of Gradle are understood: repeated subtree (*), version substitution (->), not resolved (n), strict versions', () => {
    const tree = [
      '+--- com.google.android.gms:play-services-base:18.0.0 -> 18.1.0 (*)',
      '+--- com.google.mlkit:barcode-scanning:{strictly 17.3.0} -> 17.3.0',
      '+--- com.google.firebase:firebase-common (n)',
      '\\--- org.example:lib -> com.google.android.odml:image:1.0.0',
    ];
    assert.deepEqual(checkGradleDependencies(BOTH(tree)), [
      `:app: com.google.android.gms:play-services-base in releaseRuntimeClasspath (from ${ROOT})`,
      `:app: com.google.mlkit:barcode-scanning in releaseRuntimeClasspath (from ${ROOT})`,
      `:app: com.google.firebase:firebase-common in releaseRuntimeClasspath (from ${ROOT})`,
      `:app: com.google.android.odml:image in releaseRuntimeClasspath (from ${ROOT})`,
    ]);
  });

  it('EVM-108 AC8: a constraint (c) is not a dependency (it pulls nothing in) and is not reported', () => {
    assert.deepEqual(checkGradleDependencies(BOTH(['+--- com.google.android.gms:play-services-base:18.0.0 (c)', ...CLEAN])), []);
  });

  it('EVM-108 AC8: ML Kit only in compileClasspath (a compileOnly dependency) is no finding: only the release runtime section counts', () => {
    const text = [
      report(':app', CLEAN),
      [
        '> Task :expo-camera:dependencies',
        '',
        SEPARATOR,
        "Project ':expo-camera'",
        SEPARATOR,
        '',
        "compileClasspath - Compile classpath for 'release'.",
        '+--- com.google.mlkit:barcode-scanning:17.3.0',
        '\\--- com.google.android.gms:play-services-code-scanner:16.1.0',
        '',
        HEADER,
        ...CLEAN,
        '',
        'releaseUnitTestRuntimeClasspath - Runtime classpath of unit tests.',
        '\\--- com.google.mlkit:barcode-scanning:17.3.0',
        '',
      ].join('\n'),
    ].join('\n');
    assert.deepEqual(checkGradleDependencies(text), []);
  });

  it('EVM-108 AC8: ML Kit deep in the release runtime tree of the library is found', () => {
    const tree = [
      '+--- androidx.appcompat:appcompat:1.7.1',
      '|    \\--- androidx.core:core:1.18.0',
      '|         \\--- com.google.mlkit:x:1.0',
    ];
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, tree)), [
      ':expo-camera: com.google.mlkit:x in releaseRuntimeClasspath (from androidx.core:core)',
    ]);
  });

  it('EVM-108 AC8: a coordinate is reported once per project, the app and the library separately', () => {
    const tree = ['+--- com.google.mlkit:a:1', '|    \\--- com.google.mlkit:a:1', '\\--- com.google.mlkit:a:1 (*)'];
    assert.deepEqual(checkGradleDependencies(BOTH(tree, tree)), [
      `:app: com.google.mlkit:a in releaseRuntimeClasspath (from ${ROOT})`,
      `:expo-camera: com.google.mlkit:a in releaseRuntimeClasspath (from ${ROOT})`,
    ]);
  });

  it('EVM-108 AC8: an empty file, a missing project, a missing section or an empty section fail closed', () => {
    assert.deepEqual(checkGradleDependencies(''), ['the dependency report is empty']);
    assert.deepEqual(checkGradleDependencies('  \n'), ['the dependency report is empty']);
    assert.deepEqual(checkGradleDependencies(report(':app', CLEAN)), [':expo-camera: the report of the project is missing']);
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, []).replaceAll(`${HEADER}\n`, '')), [
      ':app: the section releaseRuntimeClasspath is missing',
      ':expo-camera: the section releaseRuntimeClasspath is missing',
    ]);
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, [])), [':expo-camera: the section releaseRuntimeClasspath holds no dependency']);
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, ['No dependencies'])), [
      ':expo-camera: the section releaseRuntimeClasspath holds no dependency',
    ]);
  });

  it('EVM-108 AC8: a FAILED resolution fails closed (the tree is incomplete), also in a repeated subtree', () => {
    assert.deepEqual(checkGradleDependencies(BOTH(['+--- org.example:lib:1.0 FAILED', ...CLEAN])), [
      ':app: org.example:lib could not be resolved (FAILED); the tree is incomplete',
    ]);
    assert.deepEqual(checkGradleDependencies(BOTH(CLEAN, ['\\--- org.example:lib FAILED'])), [
      ':expo-camera: org.example:lib could not be resolved (FAILED); the tree is incomplete',
    ]);
  });

  it('EVM-108 AC8: only the required projects are read, and the list can be given', () => {
    assert.deepEqual(checkGradleDependencies(report(':other', CLEAN), [':other']), []);
    assert.deepEqual(checkGradleDependencies(report(':other', ['\\--- com.google.mlkit:a:1']), [':other']), [
      `:other: com.google.mlkit:a in releaseRuntimeClasspath (from ${ROOT})`,
    ]);
  });

  it('EVM-108 AC8: a project block ends at the next project header (the next block is not read as the previous one)', () => {
    const text = `${report(':app', CLEAN)}\n${report(':expo-camera', ['\\--- com.google.mlkit:a:1'])}`;
    assert.deepEqual(checkGradleDependencies(text), [`:expo-camera: com.google.mlkit:a in releaseRuntimeClasspath (from ${ROOT})`]);
  });

  it('EVM-108 AC8: the coordinates and prefixes of one list are recognised exactly (no prefix lookalike)', () => {
    assert.equal(isForbiddenCoordinate('com.google.mlkit', 'x'), true);
    assert.equal(isForbiddenCoordinate('com.google.mlkitx', 'x'), false);
    assert.equal(isForbiddenCoordinate('androidx.camera', 'camera-core'), false);
    assert.equal(isForbiddenCoordinate('androidx.camera', 'camera-mlkit-vision'), true);
    assert.equal(forbiddenPrefixOf('com.google.android.odml.image.X'), 'com.google.android.odml');
    assert.equal(forbiddenPrefixOf('androidx.camera.mlkit.vision.Y'), 'androidx.camera.mlkit');
    assert.equal(forbiddenPrefixOf('androidx.camera.core.Z'), undefined);
    assert.equal(forbiddenPrefixOf('com.google.android.gmsx'), undefined);
    assert.equal(forbiddenPrefixOf('com.google.mlkit'), 'com.google.mlkit');
  });
});

describe('mapping.txt of R8 (EVM-108 AC8; the names in DEX are renamed, the mapping holds the source names)', () => {
  const FILE_HEADER = '# compiler: R8\n# compiler_version: 8.5.0\n';
  const clean = `${FILE_HEADER}pl.eviacharge.manager.MainActivity -> a.a:\n    void onCreate(android.os.Bundle) -> onCreate\nandroidx.camera.core.Camera -> a.b:\n`;

  it('EVM-108 AC8: a mapping without classes of the forbidden groups passes', () => {
    assert.deepEqual(checkMapping(clean), []);
  });

  it('EVM-108 AC8: a source class of every forbidden prefix is found, renamed or not; members are not classes', () => {
    for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
      const name = `${prefix}.vision.Thing$Inner`;
      assert.deepEqual(checkMapping(`${clean}${name} -> b.c:\n    int field -> a\n`), [
        `mapping.txt: 1 class of ${prefix} (for example ${name})`,
      ]);
    }
    assert.deepEqual(checkMapping(`${clean}    com.google.mlkit.Member x -> a\n`), []);
  });

  it('EVM-108 AC8: several classes of one prefix are one finding with the count', () => {
    const text = `${clean}com.google.mlkit.A -> b.a:\ncom.google.mlkit.B -> b.b:\n`;
    assert.deepEqual(checkMapping(text), ['mapping.txt: 2 classes of com.google.mlkit (for example com.google.mlkit.A)']);
  });

  it('EVM-108 AC8: an empty mapping or one without classes fails closed (minification is on, so there must be a mapping)', () => {
    const message = 'mapping.txt is empty or holds no class (minification is on: a mapping is required)';
    assert.deepEqual(checkMapping(''), [message]);
    assert.deepEqual(checkMapping(FILE_HEADER), [message]);
  });
});
