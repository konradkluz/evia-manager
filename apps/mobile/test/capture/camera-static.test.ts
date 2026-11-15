// What the source of the camera may and may not do (EVM-108 AC1, AC3; security 16; SR-FILE-08, SR-MOB-02): pinned as a static check, so a later change
// (a new option, a new permission, a call of the system camera) fails here before it fails a review.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PICTURE_OPTIONS } from '../../src/capture/camera-options';

const SRC = join(__dirname, '..', '..', 'src');
const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
const read = (path: string): string => readFileSync(path, 'utf8');
const all = files(SRC);
const CAMERA_FILES = [
  join(SRC, 'screens', 'CameraScreen.tsx'),
  join(SRC, 'screens', 'CameraPermissionScreen.tsx'),
  join(SRC, 'capture', 'camera-permission.ts'),
  join(SRC, 'capture', 'camera-options.ts'),
  join(SRC, 'capture', 'capture-pipeline.ts'),
  join(SRC, 'ui', 'CameraShutter.tsx'),
  join(SRC, 'ui', 'CameraPanel.tsx'),
];
const IMPORT_FROM_CAMERA = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'expo-camera'/g;

describe('the source of the camera (EVM-108 AC1, AC3; security 16)', () => {
  it('EVM-108 AC1: the options of takePictureAsync are ONE frozen constant without metadata, text form or callback; the screen passes nothing else', () => {
    expect(PICTURE_OPTIONS).toEqual({ quality: 0.9 });
    expect(Object.isFrozen(PICTURE_OPTIONS)).toBe(true);
    const calls = all.flatMap((path) => [...read(path).matchAll(/takePictureAsync\(([^)]*)\)/g)].map((match) => match[1]));
    expect(calls).toEqual(['PICTURE_OPTIONS']);
    for (const path of CAMERA_FILES) expect(read(path)).not.toMatch(/\bexif\b|additionalExif|base64|onPictureSaved|\bGPS\b/i);
  });

  it('EVM-108 AC3: of the whole library the app imports the view and the camera permission hook - nothing about the microphone, the scanners or other permissions', () => {
    const imported = all.flatMap((path) =>
      [...read(path).matchAll(IMPORT_FROM_CAMERA)].flatMap((match) =>
        (match[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    );
    expect([...new Set(imported)].sort()).toEqual(['CameraView', 'useCameraPermissions']);
    // no deep import and no namespace import of the library: every use is visible in the list above
    expect(all.filter((path) => /expo-camera\/|\*\s+as\s+\w+\s+from\s+'expo-camera'|require\('expo-camera'\)/.test(read(path)))).toEqual(
      [],
    );
  });

  it('EVM-108 AC1: nothing of the app reaches the gallery, the location, the system camera or the external storage', () => {
    const forbidden =
      /expo-image-picker|expo-media-library|expo-location|expo-intent-launcher|MediaStore|ACTION_IMAGE_CAPTURE|getExternal|launchCameraAsync|saveToLibrary/;
    expect(all.filter((path) => forbidden.test(read(path)))).toEqual([]);
  });

  it('EVM-108 AC2: the view is always a photo camera of the back lens, without scanners, sound or recording; "active" depends on focus, foreground AND the app lock', () => {
    // the code, not the comments that explain what is left out
    const screen = read(join(SRC, 'screens', 'CameraScreen.tsx'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(screen).toMatch(/mode="picture"/);
    expect(screen).toMatch(/facing="back"/);
    expect(screen).toMatch(/active=\{focused && foreground && !locked\}/);
    expect(screen).not.toMatch(/mode="video"|recordAsync|barcodeScannerSettings|onBarcodeScanned|\bmute\b|\bmicrophone\b/i);
    expect(screen).not.toMatch(/ActivityIndicator|Spinner|Skeleton/);
  });

  it('EVM-108 AC4: the screens of the camera use no literal colour (tokens and the library only)', () => {
    for (const path of CAMERA_FILES.filter((file) => file.includes('screens') || file.includes('ui'))) {
      expect(read(path)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
    }
  });
});
