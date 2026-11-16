// EVM-110 AC6: the key texts of the film mode, of the row "Czeka na Wi-Fi", of the banner and of the switch are not cut at 200% font. A layout engine is not in Jest, so
// the proof is the SOURCE of the parts: no limit of lines, no switched-off scaling of the font, no fixed height of a container that holds text (min-heights only).
// The pattern of the earlier camera tests (EVM-108) was the same: the rules are pinned where the code can break them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');
const read = (...parts: string[]): string =>
  readFileSync(join(SRC, ...parts), 'utf8')
    // the code, not the comments that explain it
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const PARTS: readonly (readonly [string, string[]])[] = [
  ['the camera screen (mode, counter, warning, markers)', ['screens', 'CameraScreen.tsx']],
  ['the panel of the camera', ['ui', 'CameraPanel.tsx']],
  ['the row of a file ("Czeka na Wi-Fi", the length and size of a film)', ['screens', 'FileRow.tsx']],
  ['the files of the Queue (the banner "n filmów czeka na Wi-Fi")', ['screens', 'QueueFiles.tsx']],
  ['"Więcej" (the switch)', ['screens', 'MoreScreen.tsx']],
  ['the switch', ['ui', 'SwitchRow.tsx']],
  ['the notice of a killed recording', ['screens', 'InterruptedRecordingNotice.tsx']],
  ['the alert of the library (the warning, the banner)', ['ui', 'InlineAlert.tsx']],
];

describe('200% font: nothing that carries a key text is cut (EVM-110 AC6)', () => {
  it.each(PARTS)('EVM-110 AC6: %s - no limit of lines, no switched-off font scaling', (_name, path) => {
    const code = read(...path);
    expect(code).not.toMatch(/numberOfLines/);
    expect(code).not.toMatch(/allowFontScaling\s*=\s*\{?\s*false/);
    expect(code).not.toMatch(/maxFontSizeMultiplier/);
  });

  it.each(PARTS)('EVM-110 AC6: %s - no fixed height of a container with text (only min-heights)', (_name, path) => {
    const lines = read(...path)
      .split('\n')
      // the track of the switch holds a thumb and no text; the progress and the icons are sized by tokens
      .filter((line) => !/track|thumb|size\.icon|iconSize/.test(line));
    const fixed = lines.filter((line) => /(^|[^A-Za-z])(height|maxHeight)\s*:/.test(line));
    expect(fixed).toEqual([]);
  });

  it('EVM-110 AC2: the toast of the end of a recording has no limit of lines (the default of the toast, two lines, cuts the long messages at 200%)', () => {
    const toast = read('ui', 'Toast.tsx');
    expect(toast).toMatch(/numberOfLines=\{fullText \? undefined : 2\}/);
    expect(read('screens', 'CameraScreen.tsx')).toMatch(/fullText: true/);
  });

  it('EVM-110 AC6: the warning of the last minute is on the preview, outside the panel (it never makes the panel grow)', () => {
    const screen = read('screens', 'CameraScreen.tsx');
    const notice = /const notice =[\s\S]*?\) : undefined;/.exec(screen)?.[0] ?? '';
    expect(notice.length).toBeGreaterThan(100);
    expect(notice).not.toMatch(/warnMinute|camera-warn-minute/);
    expect(screen).toMatch(/camera-warn-minute/);
  });

  it('EVM-110 AC6: the chips of the panel scroll sideways (a longer label does not cut or squeeze the others) and the labels have no fixed width', () => {
    const panel = read('ui', 'CameraPanel.tsx');
    expect(panel.match(/horizontal/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read('ui', 'FilterChip.tsx')).not.toMatch(/[{,\s]width\s*:/);
  });
});
