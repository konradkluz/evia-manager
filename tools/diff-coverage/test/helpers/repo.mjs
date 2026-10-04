// @ts-check
/** Temporary git repositories with synthetic content for integration tests (no network, no remote). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_FLAGS = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

/** @param {string} prefix */
export function tempRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', [...GIT_FLAGS, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet', '--initial-branch=main']);
  return {
    root,
    git,
    /** @param {string} path @param {string} text */
    write(path, text) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    },
    /** @param {string} message */
    commit(message) {
      git(['add', '--all']);
      git(['commit', '--quiet', '--allow-empty', '-m', message]);
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Captures text written by the tool. */
export function capture() {
  let text = '';
  return {
    stream: {
      /** @param {string} chunk */
      write(chunk) {
        text += chunk;
        return true;
      },
    },
    get text() {
      return text;
    },
  };
}
