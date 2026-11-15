import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireOptionalNativeModule } from 'expo';
import { EVIA_UPLOAD_EVENTS, EVIA_UPLOAD_FUNCTIONS, EVIA_UPLOAD_MODULE_NAME, loadEviaUpload } from '../modules/evia-upload/src';
import type { EviaUploadModule } from '../modules/evia-upload/src';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const MODULE_DIR = join(__dirname, '..', 'modules', 'evia-upload');
const KOTLIN = readFileSync(
  join(MODULE_DIR, 'android', 'src', 'main', 'java', 'pl', 'eviacharge', 'upload', 'android', 'EviaUploadModule.kt'),
  'utf8',
);
/** The Kotlin text without comments: the doc comments mention names that are not code. */
const CODE = KOTLIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('EviaUpload binding (EVM-130 AC2, AC3; SR-SESS-09)', () => {
  it('EVM-130 AC2: the loader asks the platform for the module by its name and gives null where there is none', () => {
    const mocked = jest.mocked(requireOptionalNativeModule);
    mocked.mockReturnValueOnce(null);
    expect(loadEviaUpload()).toBeNull();
    expect(mocked).toHaveBeenCalledWith('EviaUpload');
    const native = { stageLogin: jest.fn() } as unknown as EviaUploadModule;
    mocked.mockReturnValueOnce(native);
    expect(loadEviaUpload()).toBe(native);
    expect(EVIA_UPLOAD_MODULE_NAME).toBe('EviaUpload');
  });

  it('EVM-130 AC2: the binding lists exactly the functions the Kotlin module defines, and the events it declares', () => {
    const defined = [...CODE.matchAll(/(?:AsyncFunction|Function)\("([A-Za-z0-9]+)"\)/g)].map((match) => match[1] ?? '');
    expect([...defined].sort()).toEqual([...EVIA_UPLOAD_FUNCTIONS].sort());
    expect(new Set(EVIA_UPLOAD_FUNCTIONS).size).toBe(EVIA_UPLOAD_FUNCTIONS.length);
    const events = /Events\(([^)]*)\)/.exec(CODE)?.[1] ?? '';
    expect([...events.matchAll(/"([A-Za-z0-9]+)"/g)].map((match) => match[1])).toEqual([...EVIA_UPLOAD_EVENTS]);
    expect(/Name\("([A-Za-z0-9]+)"\)/.exec(CODE)?.[1]).toBe(EVIA_UPLOAD_MODULE_NAME);
  });

  it('EVM-130 AC3: no function of the module returns a refresh token or a revocation token, and none takes the bytes of a file', () => {
    expect(
      EVIA_UPLOAD_FUNCTIONS.filter((name) => /^(get|read|load|fetch|export)[A-Za-z]*(refresh|revocation)|bytes|base64/i.test(name)),
    ).toEqual([]);
    // no answer map of the Kotlin module has a key that names a refresh or a revocation token
    expect(CODE).not.toMatch(/"(refreshToken|revocationToken|revocation[A-Za-z]*|refresh[A-Za-z]*)"\s+to\b/);
    // the refresh token only comes IN: it is an argument of the two sign-in functions and of nothing else
    const takers = [...CODE.matchAll(/(?:AsyncFunction|Function)\("([A-Za-z0-9]+)"\)\s*\{([^>]*)->/g)]
      .filter((match) => /refreshToken/.test(match[2] ?? ''))
      .map((match) => match[1]);
    expect(takers).toEqual(['stageLogin', 'commitLogin']);
    expect(CODE).not.toMatch(/readBytes|readText|Base64/);
  });

  it('EVM-130 AC5: the e2e hook is gated by the e2e switch of the build in the native code, and the wipe is one call', () => {
    expect(CODE).toMatch(/AsyncFunction\("e2eInjectFile"\)[\s\S]*?rt\.config\.e2eCleartext/);
    expect(EVIA_UPLOAD_FUNCTIONS).toContain('wipeUploads');
    expect(EVIA_UPLOAD_FUNCTIONS).toContain('clearWipeMarkerAfterLogin');
  });

  it('EVM-108 AC1: the import answers only a code of the closed list and the glue holds no logic - the checks are in the engine; sign-out empties the camera cache', () => {
    expect(EVIA_UPLOAD_FUNCTIONS).toContain('importOriginal');
    expect(EVIA_UPLOAD_FUNCTIONS).toContain('sweepOriginals');
    expect(CODE).toMatch(/AsyncFunction\("importOriginal"\)\s*\{[^}]*rt\.importer\.import\(assetId, sourceUri\)\.wire/);
    expect(CODE).toMatch(/AsyncFunction\("sweepOriginals"\)\s*\{[^}]*rt\.importer\.sweep\(/);
    expect(CODE).toMatch(/AsyncFunction\("signOut"\)[\s\S]*?rt\.importer\.clearLeftovers\(\)/);
    // the capture cache of the app is the only source the module is told about; no external or shared storage
    const runtime = readFileSync(
      join(MODULE_DIR, 'android', 'src', 'main', 'java', 'pl', 'eviacharge', 'upload', 'android', 'UploadRuntime.kt'),
      'utf8',
    );
    expect(runtime).toMatch(/File\(app\.cacheDir, "Camera"\)/);
    expect(CODE).not.toMatch(/ACTION_IMAGE_CAPTURE|MediaStore|getExternal|Environment\.DIRECTORY|setLocation|TAG_GPS/);
  });
});
