// EVM-110: the code of the last failed save of a film (e2e only). The slot of a release bundle does nothing; the panel of the e2e variant writes ONE short code to a
// file the tool reads with `run-as` after a failed flow - never a path, a message or data.
import { reportFilmFailure as slotReport } from '../src/e2e-hooks';
import { reportFilmFailure, FILM_ERROR_FILE } from '../src/e2e-hooks/panel';

const mockWrites: { path: string; text: string }[] = [];
let mockBroken = false;
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///data/user/0/synthetic/files' },
  File: class {
    readonly uri: string;
    exists = false;
    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }
    create(): void {
      if (mockBroken) throw new Error('disk (synthetic)');
    }
    write(text: string): void {
      mockWrites.push({ path: this.uri, text });
    }
  },
}));

beforeEach(() => {
  mockWrites.length = 0;
  mockBroken = false;
});

describe('the code of a failed film (EVM-110)', () => {
  it('EVM-110 AC1: the slot of a release bundle writes nothing and keeps nothing', () => {
    expect(() => {
      slotReport('import_io_error');
    }).not.toThrow();
    expect(mockWrites).toEqual([]);
  });

  it('EVM-110 AC1: the panel writes the code into the file of the app - only a short word of lower-case letters, digits and underscores', () => {
    reportFilmFailure('import_io_error');
    expect(mockWrites).toEqual([{ path: `file:///data/user/0/synthetic/files/${FILM_ERROR_FILE}`, text: 'import_io_error' }]);
    for (const hostile of ['/data/user/0/pkg/file.mp4', 'Error: failed to open /x', '', 'a'.repeat(61), 'ok code']) {
      mockWrites.length = 0;
      reportFilmFailure(hostile);
      expect(mockWrites.map((write) => write.text)).toEqual(['invalid_code']);
    }
  });

  it('EVM-110 AC1: a file that cannot be written never breaks the screen', () => {
    mockBroken = true;
    expect(() => {
      reportFilmFailure('digest');
    }).not.toThrow();
  });
});
